// Moris — Chat hỏi đáp bằng NGÔN NGỮ TỰ NHIÊN (RAG trên dữ liệu catalogue)
// POST /api/moris/chat { message, history? }
//
// CHỈ TRẢ LỜI BẰNG DỮ LIỆU: toàn bộ câu trả lời và danh sách mã hàng
// được suy ra BĂNG CÁCH deterministic (metadata rank) trên kết quả retrieval.
// KHÔNG gọi LLM, không sinh text từ model → không thể bịa mã linh kiện.
//
// Luồng:
//   1. INPUT: nhận câu hỏi text (validate session).
//   2. RETRIEVER: tách từ khóa → search đa anchor → gộp + dedupe.
//   3. RANKER: rankMetadata chấm điểm trên pool (không có bước chọn của model).
//   4. PRESENT: top N kết quả → câu trả lời liệt kê mã + tính năng nhận diện.
//
// Contract với frontend (không đổi): { ok, answer, candidates[], user_message, ... }

import { validateSession, searchCatalogue, scanCatalogue } from "../../_lib/moris/v5/connectors/supabase.js";
import { parseTextConstraints, buildSearchAnchors } from "../../_lib/moris/v5/retrieval/textConstraints.js";
import { rankMetadata } from "../../_lib/moris/v5/retrieval/metadataFilter.js";
import { json, readJson } from "../../_lib/shared/http.js";

/**
 * Tách từ khóa + tìm kiếm đa anchor.
 * Trả về pool candidates đã dedupe.
 */
async function retrieveTextPool(env, token, message) {
  const constraints = parseTextConstraints(message);
  const anchors = buildSearchAnchors(constraints);
  const collected = [];

  // 1. Search nguyên câu gốc
  const originalRows = await searchCatalogue(env, token, {
    search: message,
    usageSide: "all",
    viewMode: "all",
    limit: 80,
    offset: 0
  }).catch(() => []);
  collected.push(...originalRows);

  // 2. Search từng anchor riêng biệt
  for (const anchor of anchors.slice(0, 6)) {
    const rows = await searchCatalogue(env, token, {
      search: anchor,
      usageSide: "all",
      viewMode: "all",
      limit: 40,
      offset: 0
    }).catch(() => []);
    collected.push(...rows);

    if (dedupeRows(collected).length >= 60) break;
  }

  // 3. Nếu quá ít kết quả → scan toàn bộ catalogue để không bỏ sót
  let pool = dedupeRows(collected);
  if (pool.length < 5) {
    const scanned = await scanCatalogue(env, token, { maxRows: 500 }).catch(() => []);
    pool = dedupeRows([...pool, ...scanned]);
  }

  return { pool, constraints, anchors };
}

function dedupeRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row?.id ?? row?.code ?? "");
    if (!key || map.has(key)) continue;
    map.set(key, row);
  }
  return [...map.values()];
}

/** Chuyển 1 dòng catalogue → object candidate đúng contract frontend. */
function toCandidate(row, rank) {
  const score = Number(row.metadata_score || 0);
  const features = String(row.identifying_features || "").trim();
  return {
    id: String(row.id || row.code || ""),
    code: row.code || null,
    part_id: row.part_id || null,
    identifying_features: row.identifying_features || null,
    confusing_note: row.confusing_note || null,
    usage_side: row.usage_side || null,
    view_mode: row.view_mode || null,
    thumb_path: row.thumb_path || row.fallback_path || null,
    front_path: row.front_path || null,
    back_path: row.back_path || null,
    thumb_provider: row.thumb_provider || "r2",
    front_provider: row.front_provider || "r2",
    match_reason: features.slice(0, 160) || null,
    confidence: score >= 0.6 ? "high" : score >= 0.3 ? "medium" : "low",
    match_score: score,
    final_score: score,
    vector_similarity: 0,
    raw_vector_similarity: 0,
    probe_consensus: 0,
    structural_score: null,
    score_source: "metadata_rank",
    reason: features.slice(0, 160) || null,
    matched: [],
    conflicts: [],
    unknown: [],
    rank
  };
}

/** Sinh câu trả lời liệt kê mã — thuần dữ liệu, không sinh text từ model. */
function buildAnswer(candidates, message) {
  if (!candidates.length) {
    return `Em chưa tìm thấy mã nào khớp với “${message}”. Anh thử mô tả thêm đặc điểm (kích thước, số lỗ, chất liệu) nhé.`;
  }
  const head = `Em tìm thấy ${candidates.length} mã phù hợp nhất với yêu cầu của anh:`;
  const list = candidates.map((c, i) => {
    const feats = String(c.identifying_features || "").trim();
    return `${i + 1}. ${c.code}${feats ? ` — ${feats}` : ""}`;
  });
  return [head, "", ...list, "", "Anh chọn mã cần xem để em gửi ảnh nhé."].join("\n");
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await readJson(request, { maxBytes: 1_000_000 });
  } catch {
    return json({ ok: false, user_message: "JSON body không hợp lệ." }, 400);
  }

  const token = String(body?.session_token || request.headers.get("x-session-token") || "");
  try {
    await validateSession(env, token);
  } catch (e) {
    return json({ ok: false, user_message: e?.message || "Session không hợp lệ." }, 401);
  }

  const message = String(body?.message || "").trim().slice(0, 4000);
  if (!message) {
    return json({ ok: false, user_message: "Cần câu hỏi cho Moris." }, 400);
  }

  try {
    // ── RETRIEVER: tách từ khóa + search đa anchor ──────────────────
    const { pool } = await retrieveTextPool(env, token, message);

    // ── RANKER: chấm điểm metadata (deterministic, không model) ─────
    const ranked = rankMetadata(pool, message)
      .filter(row => Number(row.metadata_score || 0) >= 0.10)
      .slice(0, 20);

    const top = ranked.length >= 3 ? ranked : pool.slice(0, 15);

    // ── PRESENT: top 5 + câu trả lời liệt kê ────────────────────────
    const candidates = top.slice(0, 5).map((row, i) => toCandidate(row, i + 1));
    const answer = buildAnswer(candidates, message);

    return json({
      ok: true,
      engine: "moris-chat-rag",
      answer,
      candidates,
      user_message: answer,
      sources_count: top.length,
      model_used: null,
      provider_used: null,
      protocol: null
    });
  } catch (e) {
    console.error("[moris-chat]", e.message);
    return json(
      { ok: false, user_message: "Moris chưa thể trả lời lúc này. Anh thử lại nhé.", code: e.code },
      502
    );
  }
}
