// Kim v6 — Chat hỏi đáp bằng NGÔN NGỮ TỰ NHIÊN (RAG trên dữ liệu catalogue)
// POST /api/kim/chat { message, history? }
//
// Mục tiêu: khi anh hỏi Thư ký Kim bằng ngôn ngữ tự nhiên, hệ thống hiểu
// hoàn toàn dữ liệu catalogue và trả về TOP 5 mã hàng phù hợp nhất —
// CÙNG định dạng với tìm kiếm bằng ảnh (candidates[]) để frontend render thống nhất.
//
// Luồng (VAI TRÒ RÕ RÀNG):
//   1. INPUT: nhận câu hỏi text từ người dùng (validate session).
//   2. RETRIEVER (deterministic): tách từ khóa → tìm nhiều lần → gộp kết quả.
//      KHÔNG dùng LLM, không thể bịa.
//   3. ORCHESTRATOR (LLM): đọc RAG context, CHỌN Top 5 trong pool đã cho,
//      sinh câu trả lời tiếng Việt. Đây là người trả kết quả cuối cùng.
//
// Không khóa cứng model/provider: apiRotator tự xoay vòng theo cấu hình
// trong Supabase table kim_provider_config (hoặc env KIM_PROVIDERS),
// tự fallback khi một provider lỗi/hết quota.

import { validateSession, searchCatalogue, scanCatalogue } from "../../_lib/kim/v5/connectors/supabase.js";
import { parseTextConstraints, buildSearchAnchors } from "../../_lib/kim/v5/retrieval/textConstraints.js";
import { rankMetadata } from "../../_lib/kim/v5/retrieval/metadataFilter.js";
import { json, readJson } from "../../_lib/shared/http.js";
import { callJson } from "../../_lib/kim/v6/apiRotator.js";

const SYSTEM_PROMPT = `Bạn là Thư ký Kim của hệ thống Catalogue AI (DictionaryAI) — trợ lý tra cứu linh kiện công nghiệp (bushing, bạc lót, cao su...).

Bạn được cung cấp dữ liệu catalogue trích xuất TRỰC TIẾP từ database. Nguyên tắc bắt buộc:
1. CHỈ trả lời và chọn mã dựa trên dữ liệu được cung cấp; tuyệt đối KHÔNG bịa mã linh kiện hay đặc điểm không có trong dữ liệu.
2. Khi câu hỏi là tra cứu/so sánh mã hàng: chọn TOP 5 bản ghi phù hợp nhất từ dữ liệu, mỗi mục nêu rõ lý do khớp dựa trên identifying_features.
3. Phân tích SÂU đặc điểm: nếu user nói "giống con chim" thì tìm bản ghi có identifying_features chứa "chim". Nếu nói "7 lỗ" thì tìm bản ghi có "7 lỗ tròn". Đối chiếu từng đặc điểm.
4. Nếu dữ liệu không đủ, nói rõ "em chưa tìm thấy dữ liệu phù hợp" và gợi ý cách hỏi khác.
5. Trả lời bằng tiếng Việt, ngắn gọn, lễ phép (gọi người dùng là "anh").
6. Trả về JSON đúng cấu trúc được yêu cầu.`;

/**
 * Tách từ khóa + tìm kiếm đa anchor (giống retrieveTextCandidates trong Kim v5).
 * Trả về pool candidates đã dedup + rank.
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
    return json({ ok: false, user_message: "Cần câu hỏi cho Thư ký Kim." }, 400);
  }

  try {
    // ── RETRIEVER: tách từ khóa + search đa anchor ──────────────────
    const { pool, constraints } = await retrieveTextPool(env, token, message);

    // Rank metadata để chọn top candidates cho LLM
    const ranked = rankMetadata(pool, message)
      .filter(row => Number(row.metadata_score || 0) >= 0.10)
      .slice(0, 20);

    // Nếu rank quá ít, lấy thêm từ pool
    const contextRows = ranked.length >= 3 ? ranked : pool.slice(0, 15);

    // Build context với ĐẦY ĐỦ thông tin ảnh cho frontend
    const context = contextRows.map(r => ({
      id: r.id || null,
      code: r.code || null,
      part_id: r.part_id || null,
      identifying_features: r.identifying_features || null,
      confusing_note: r.confusing_note || null,
      usage_side: r.usage_side || null,
      view_mode: r.view_mode || null,
      thumb_path: r.thumb_path || r.fallback_path || null,
      front_path: r.front_path || null,
      back_path: r.back_path || null,
      thumb_provider: r.thumb_provider || "r2",
      front_provider: r.front_provider || "r2",
      metadata_score: r.metadata_score || null
    }));

    // ── Lịch sử hội thoại (tối đa 8 tin gần nhất) ────────────────────
    const history = Array.isArray(body?.history)
      ? body.history.slice(-8).map(h => ({
          role: h?.role === "user" ? "user" : "assistant",
          content: String(h?.text || h?.content || "").slice(0, 1500)
        }))
      : [];

    // ── ORCHESTRATOR (LLM): chọn Top 5 trong pool + sinh câu trả lời ─
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      {
        role: "user",
        content:
          `Câu hỏi: ${message}\n\n` +
          `DỮ LIỆU CATALOGUE (${context.length} bản ghi liên quan nhất):\n` +
          JSON.stringify(context, null, 2) +
          `\n\nHãy phân tích SÂU identifying_features của từng bản ghi và đối chiếu với câu hỏi. ` +
          `Ví dụ: nếu hỏi "giống con chim" → tìm bản ghi có "chim" trong identifying_features. ` +
          `Nếu hỏi "7 lỗ" → tìm bản ghi có "7 lỗ tròn".\n\n` +
          `Trả JSON đúng cấu trúc:\n` +
          `{"top5":[{"rank":1,"code":"...","part_id":"...","id":"...","match_reason":"lý do khớp ngắn gọn","confidence":"high|medium|low"}],"answer":"câu trả lời tiếng Việt tự nhiên, ngắn gọn"}`
      }
    ];

    const result = await callJson(env, "orchestrator", messages, {
      temperature: 0.2,
      maxTokens: 2048,
      responseFormat: { type: "json_object" }
    });

    const parsed = result.json || {};
    const llmTop5 = Array.isArray(parsed.top5) ? parsed.top5 : [];
    const answer = String(parsed.answer || result.content || "").trim();

    // Map LLM top5 back to full context rows (để có ảnh)
    const contextById = new Map(context.map(r => [String(r.id || r.code), r]));
    const candidates = llmTop5.map(item => {
      const full = contextById.get(String(item.id)) || contextById.get(String(item.code)) || {};
      return {
        id: String(item.id || full.id || item.code || ""),
        code: item.code || full.code || null,
        part_id: item.part_id || full.part_id || null,
        identifying_features: full.identifying_features || null,
        confusing_note: full.confusing_note || null,
        usage_side: full.usage_side || null,
        view_mode: full.view_mode || null,
        thumb_path: full.thumb_path || null,
        front_path: full.front_path || null,
        back_path: full.back_path || null,
        thumb_provider: full.thumb_provider || "r2",
        front_provider: full.front_provider || "r2",
        match_reason: item.match_reason || null,
        confidence: item.confidence || "medium",
        match_score: Number(full.metadata_score || 0),
        final_score: Number(full.metadata_score || 0),
        vector_similarity: 0,
        raw_vector_similarity: 0,
        probe_consensus: 0,
        structural_score: null,
        score_source: "chat_rag",
        reason: item.match_reason || null,
        matched: [],
        conflicts: [],
        unknown: []
      };
    }).filter(c => c.code || c.id);

    // Nếu LLM không trả top5 hợp lệ, fallback trả ranked results
    const finalCandidates = candidates.length > 0 ? candidates : contextRows.slice(0, 5).map(r => ({
      id: String(r.id || ""),
      code: r.code || null,
      part_id: r.part_id || null,
      identifying_features: r.identifying_features || null,
      confusing_note: r.confusing_note || null,
      usage_side: r.usage_side || null,
      view_mode: r.view_mode || null,
      thumb_path: r.thumb_path || r.fallback_path || null,
      front_path: r.front_path || null,
      back_path: r.back_path || null,
      thumb_provider: r.thumb_provider || "r2",
      front_provider: r.front_provider || "r2",
      match_reason: null,
      confidence: "medium",
      match_score: Number(r.metadata_score || 0),
      final_score: Number(r.metadata_score || 0),
      vector_similarity: 0,
      raw_vector_similarity: 0,
      probe_consensus: 0,
      structural_score: null,
      score_source: "metadata_rank",
      reason: null,
      matched: [],
      conflicts: [],
      unknown: []
    }));

    return json({
      ok: true,
      engine: "kim-v6-chat",
      answer,
      candidates: finalCandidates,
      user_message: answer || `Em tìm thấy ${finalCandidates.length} mã phù hợp.`,
      sources_count: context.length,
      model_used: result.modelUsed,
      provider_used: result.providerUsed,
      protocol: result.protocol
    });
  } catch (e) {
    console.error("[kim-chat]", e.message);
    return json(
      { ok: false, user_message: "Thư ký Kim chưa thể trả lời lúc này. Anh thử lại nhé.", code: e.code },
      502
    );
  }
}