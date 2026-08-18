// Kim v6 — CF-native Orchestrator (không cần VPS/bridge).
// POST /api/kim/search-dsh { message, query_embedding?, image_data_url? }
//
// Pipeline 4 tầng — VAI TRÒ RÕ RÀNG:
//   TẦNG 1 — INPUT/VISION ANALYST: nhận ảnh input, trích xuất đặc điểm cấu trúc.
//            → AI nào làm: model role "vision" qua API Rotator.
//   TẦNG 2 — VECTOR ENCODER: nhận embedding từ browser DINOv2, tra pgvector.
//            → AI nào làm: KHÔNG dùng LLM — thuần deterministic (pgvector RPC).
//   TẦNG 3 — METADATA SYNTHESIZER: tổng hợp vision + vector neighbors → refined features.
//            → AI nào làm: model role "synthesizer" qua API Rotator.
//   TẦNG 4 — RERANKER/ORCHESTRATOR: xếp hạng cuối cùng, chọn Top 5.
//            → AI nào làm: model role "orchestrator" qua API Rotator.
//
// Kích hoạt: KIM_V6_ENABLED=true trên Cloudflare Pages env vars.
// Không bật flag → trả 503, frontend fallback về /api/kim/search (Kim v5).

import { validateSession, rpc } from "../../_lib/kim/v5/connectors/supabase.js";
import { json, readJson } from "../../_lib/shared/http.js";
import { callJson } from "../../_lib/kim/v6/apiRotator.js";

// ── Vector profile: đọc từ env, KHÔNG hardcode ──────────────────
function vectorProfile(env) {
  return {
    model: String(env.KIM_VECTOR_MODEL || "dinov2_vits14"),
    modelVersion: String(env.KIM_VECTOR_MODEL_VERSION || "1"),
    preprocessVersion: String(env.KIM_PREPROCESS_VERSION || "kim_fg_v1"),
    profile: String(env.KIM_EMBEDDING_PROFILE || "cls_l2_v1"),
    dimension: Number(env.KIM_VECTOR_DIMENSION || 384),
    minSimilarity: Number(env.KIM_VECTOR_MIN || 0.55),
    topK: Number(env.KIM_VECTOR_TOP_K || 30),
  };
}

// ── RAG: tìm bản ghi catalogue liên quan cho câu hỏi text ────────
async function ragCatalogueSearch(env, token, message) {
  try {
    const rows = await rpc(env, "app_search_catalogue", {
      p_session_token: token,
      p_search: message,
      p_usage_side: "all",
      p_view_mode: "all",
      p_limit: 15,
      p_offset: 0,
    });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export async function onRequestPost({ request, env }) {
  const enabled = /^(1|true|yes|on)$/i.test(String(env.KIM_V6_ENABLED || ""));
  if (!enabled) {
    return json({ ok: false, user_message: "Kim v6 chưa được kích hoạt." }, 503);
  }

  let body;
  try {
    body = await readJson(request, { maxBytes: 8_000_000 });
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
  const imageDataUrl = String(body?.image_data_url || "").trim();
  const queryEmbedding = body?.query_embedding; // array of numbers từ browser DINOv2

  if (!message && !imageDataUrl && !queryEmbedding) {
    return json({ ok: false, user_message: "Cần message, image_data_url hoặc query_embedding." }, 400);
  }

  const profile = vectorProfile(env);
  const pipelineLog = [];
  const t0 = Date.now();

  try {
    // ══════════════════════════════════════════════════════════════
    // TẦNG 1 — INPUT / VISION ANALYST
    // AI nào làm: model role "vision" (qua API Rotator, tự xoay vòng)
    // Input: image_data_url → Output: JSON đặc điểm cấu trúc
    // ══════════════════════════════════════════════════════════════
    let visionFeatures = null;
    if (imageDataUrl && imageDataUrl.startsWith("data:image/")) {
      const [mime, base64Data] = splitDataUrl(imageDataUrl);
      const visionResult = await callJson(env, "vision", [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Phân tích ảnh linh kiện công nghiệp này. Trả JSON chính xác:
{"object_family":string|null,"dominant_colors":string[],"geometry":string[],"hole_count":number|null,"hole_layout":string|null,"visible_features":string[],"material_look":string|null,"orientation_cues":string[],"search_terms":string[],"uncertainties":string[]}`,
            },
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64Data}` } },
          ],
        },
      ], { temperature: 0.1, maxTokens: 2048, responseFormat: { type: "json_object" } });

      visionFeatures = visionResult.json || { raw: visionResult.content };
      pipelineLog.push({ tier: 1, role: "vision_analyst", model: visionResult.modelUsed, provider: visionResult.providerUsed, protocol: visionResult.protocol });
    }

    // ══════════════════════════════════════════════════════════════
    // TẦNG 2 — VECTOR ENCODER
    // AI nào làm: KHÔNG dùng LLM — deterministic pgvector search
    // Input: query_embedding (từ browser DINOv2 worker) → Output: Top-K candidates
    // ══════════════════════════════════════════════════════════════
    let vectorNeighbors = [];
    if (Array.isArray(queryEmbedding) && queryEmbedding.length === profile.dimension) {
      try {
        const rows = await rpc(env, "match_catalogue_image_vectors", {
          p_query_embedding: `[${queryEmbedding.join(",")}]`,
          p_embedding_model: profile.model,
          p_embedding_model_version: profile.modelVersion,
          p_preprocess_version: profile.preprocessVersion,
          p_embedding_profile: profile.profile,
          p_match_count: profile.topK,
        });
        vectorNeighbors = (Array.isArray(rows) ? rows : [])
          .filter(h => Number(h?.similarity || 0) >= profile.minSimilarity);
        pipelineLog.push({ tier: 2, role: "vector_encoder", count: vectorNeighbors.length, min_similarity: profile.minSimilarity });
      } catch (e) {
        pipelineLog.push({ tier: 2, role: "vector_encoder", error: e.message });
      }
    }

    // ══════════════════════════════════════════════════════════════
    // PATH TEXT-ONLY (không ảnh, không embedding) → RAG + Top-5
    // AI nào làm: model role "orchestrator" đọc RAG context → chọn Top 5
    // ══════════════════════════════════════════════════════════════
    if (!visionFeatures && vectorNeighbors.length === 0 && message) {
      const ragRows = await ragCatalogueSearch(env, token, message);
      const context = ragRows.map(r => ({
        code: r.code || r.part_id || null,
        part_id: r.part_id || null,
        identifying_features: r.identifying_features || null,
        usage_side: r.usage_side || null,
        description: r.description || r.notes || null,
      }));

      const ragResult = await callJson(env, "orchestrator", [
        {
          role: "system",
          content: `Bạn là Thư ký Kim của hệ thống Catalogue AI (DictionaryAI).
Nhiệm vụ: dựa trên dữ liệu catalogue được cung cấp, chọn TOP 5 bản ghi phù hợp nhất với câu hỏi.
Quy tắc:
1. CHỈ chọn trong dữ liệu được cho — KHÔNG bịa mã.
2. Nếu dữ liệu không đủ, nói rõ "em chưa tìm thấy dữ liệu phù hợp".
3. Trả JSON: {"top5":[{"rank":1,"code":"...","match_reason":"...","confidence":"high|medium|low"}],"answer":"câu trả lời tiếng Việt ngắn gọn"}`
        },
        {
          role: "user",
          content: `Câu hỏi: ${message}\n\nDỮ LIỆU CATALOGUE (${context.length} bản ghi):\n${JSON.stringify(context, null, 2)}`
        },
      ], { temperature: 0.2, maxTokens: 2048, responseFormat: { type: "json_object" } });

      const ragJson = ragResult.json || {};
      return json({
        ok: true,
        engine: "kim-v6",
        answer: ragJson.answer || ragResult.content,
        top5: Array.isArray(ragJson.top5) ? ragJson.top5 : [],
        sources_count: context.length,
        pipeline_log: [...pipelineLog, { tier: 4, role: "orchestrator_rag", model: ragResult.modelUsed, provider: ragResult.providerUsed }],
        elapsed_ms: Date.now() - t0,
      });
    }

    // ══════════════════════════════════════════════════════════════
    // TẦNG 3 — METADATA SYNTHESIZER
    // AI nào làm: model role "synthesizer" (qua API Rotator)
    // Input: vision features + vector neighbors metadata
    // Output: refined features + conflict detection
    // ══════════════════════════════════════════════════════════════
    let refinedFeatures = null;
    if (visionFeatures && vectorNeighbors.length > 0) {
      const synthPrompt = `Tổng hợp đặc điểm từ 2 nguồn để tinh chỉnh đặc điểm nhận dạng:
NGUỒN 1 — Vision Analyst output: ${JSON.stringify(visionFeatures)}
NGUỒN 2 — Vector neighbors metadata: ${JSON.stringify(vectorNeighbors.slice(0, 10))}
Trả JSON: {"refined_object_family":string|null,"refined_hole_count":number|null,"refined_hole_layout":string|null,"refined_geometry":string[],"refined_material":string|null,"distinguishing_marks":string[],"confidence_level":"high|medium|low","disambiguation_notes":string,"suggested_codes":string[]}`;

      const synthResult = await callJson(env, "synthesizer", [
        { role: "user", content: synthPrompt },
      ], { temperature: 0.15, maxTokens: 2048, responseFormat: { type: "json_object" } });

      refinedFeatures = synthResult.json || { raw: synthResult.content };
      pipelineLog.push({ tier: 3, role: "metadata_synthesizer", model: synthResult.modelUsed, provider: synthResult.providerUsed });
    }

    // ══════════════════════════════════════════════════════════════
    // TẦNG 4 — RERANKER / ORCHESTRATOR
    // AI nào làm: model role "orchestrator" (reasoning model)
    // Input: query + vision + synthesis + candidates
    // Output: Top 5 cuối cùng — ĐÂY LÀ NGƯỜI TRẢ KẾT QUẢ CUỐI CÙNG
    // ══════════════════════════════════════════════════════════════
    let top5 = [];
    if (vectorNeighbors.length > 0) {
      const rerankPrompt = `Xếp hạng ứng viên tìm kiếm linh kiện công nghiệp.
ĐẶC ĐIỂM TỪ ẢNH (Vision Analyst): ${JSON.stringify(visionFeatures || {})}
TINH CHỈNH (Synthesizer): ${JSON.stringify(refinedFeatures || {})}
ỨNG VIÊN TỪ VECTOR SEARCH: ${JSON.stringify(vectorNeighbors.slice(0, 20))}

Quy tắc:
- CHỈ chọn trong danh sách ỨNG VIÊN — không bịa mã ngoài.
- Penalize false positive: nếu không chắc chắn, giảm confidence.
- Trả JSON: {"top5":[{"rank":number,"code":string,"record_id":string,"similarity_score":number,"match_reason":string,"confidence":"high|medium|low","evidence_summary":string}],"analysis_notes":string,"ambiguous":boolean}`;

      const rerankResult = await callJson(env, "orchestrator", [
        { role: "user", content: rerankPrompt },
      ], { temperature: 0.05, maxTokens: 4096, responseFormat: { type: "json_object" } });

      const reranked = rerankResult.json || {};
      top5 = Array.isArray(reranked.top5) ? reranked.top5 : [];
      pipelineLog.push({ tier: 4, role: "reranker_orchestrator", model: rerankResult.modelUsed, provider: rerankResult.providerUsed, top5_count: top5.length });
    } else if (visionFeatures) {
      top5 = [{ rank: 1, note: "Chỉ có phân tích ảnh, chưa có vector search. Cần upload ảnh lên hệ thống trước.", features: visionFeatures }];
      pipelineLog.push({ tier: 4, role: "reranker_orchestrator", skipped: true, reason: "no_vector_candidates" });
    }

    // Build user-friendly answer
    const answerParts = [];
    if (top5.length > 0 && top5[0].code) {
      answerParts.push(`Tìm thấy ${top5.length} kết quả phù hợp nhất:`);
      for (const item of top5.slice(0, 5)) {
        answerParts.push(`• ${item.code} — ${item.match_reason || ""} (${item.confidence || "?"})`);
      }
    } else if (visionFeatures) {
      answerParts.push("Đã phân tích ảnh nhưng chưa tìm được kết quả khớp trong vector base.");
    } else {
      answerParts.push("Không đủ dữ liệu để tìm kiếm. Vui lòng cung cấp ảnh hoặc mô tả chi tiết hơn.");
    }

    return json({
      ok: true,
      engine: "kim-v6",
      answer: answerParts.join("\n"),
      top5,
      vision_features: visionFeatures,
      refined_features: refinedFeatures,
      pipeline_log: pipelineLog,
      elapsed_ms: Date.now() - t0,
    });

  } catch (e) {
    console.error("[kim-v6-search]", e.message);
    return json({
      ok: false,
      engine: "kim-v6",
      user_message: `Lỗi pipeline: ${e.message}`,
      code: e.code,
      pipeline_log: pipelineLog,
      elapsed_ms: Date.now() - t0,
    }, 500);
  }
}

function splitDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUrl));
  if (!m) throw new Error("Invalid data URL format");
  return [m[1], m[2]];
}