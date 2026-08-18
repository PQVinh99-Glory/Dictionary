// Kim v6 — Chat hỏi đáp bằng NGÔN NGỮ TỰ NHIÊN (RAG trên dữ liệu catalogue)
// POST /api/kim/chat { message, history? }
//
// Mục tiêu: khi anh hỏi Thư ký Kim bằng ngôn ngữ tự nhiên, hệ thống hiểu
// hoàn toàn dữ liệu catalogue và trả về TOP 5 mã hàng phù hợp nhất —
// CÙNG định dạng với tìm kiếm bằng ảnh (top5[]) để frontend render thống nhất.
//
// Luồng (VAI TRÒ RÕ RÀNG):
//   1. INPUT: nhận câu hỏi text từ người dùng (validate session).
//   2. RETRIEVER (deterministic): tìm bản ghi catalogue liên quan qua RPC
//      app_search_catalogue — KHÔNG dùng LLM, không thể bịa.
//   3. ORCHESTRATOR (LLM): đọc RAG context, CHỌN Top 5 trong pool đã cho,
//      sinh câu trả lời tiếng Việt. Đây là người trả kết quả cuối cùng.
//
// Không khóa cứng model/provider: apiRotator tự xoay vòng theo cấu hình
// trong Supabase table kim_provider_config (hoặc env KIM_PROVIDERS),
// tự fallback khi một provider lỗi/hết quota.

import { validateSession, searchCatalogue } from "../../_lib/kim/v5/connectors/supabase.js";
import { json, readJson } from "../../_lib/shared/http.js";
import { callJson } from "../../_lib/kim/v6/apiRotator.js";

const SYSTEM_PROMPT = `Bạn là Thư ký Kim của hệ thống Catalogue AI (DictionaryAI) — trợ lý tra cứu linh kiện công nghiệp (bushing, bạc lót, cao su...).

Bạn được cung cấp dữ liệu catalogue trích xuất TRỰC TIẾP từ database. Nguyên tắc bắt buộc:
1. CHỈ trả lời và chọn mã dựa trên dữ liệu được cung cấp; tuyệt đối KHÔNG bịa mã linh kiện hay đặc điểm không có trong dữ liệu.
2. Khi câu hỏi là tra cứu/so sánh mã hàng: chọn TOP 5 bản ghi phù hợp nhất từ dữ liệu, mỗi mục nêu rõ lý do khớp.
3. Nếu dữ liệu không đủ, nói rõ "em chưa tìm thấy dữ liệu phù hợp" và gợi ý cách hỏi khác.
4. Trả lời bằng tiếng Việt, ngắn gọn, lễ phép (gọi người dùng là "anh").
5. Trả về JSON đúng cấu trúc được yêu cầu.`;

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
    // ── RETRIEVER (deterministic): lấy bản ghi catalogue liên quan ─────
    const rows = await searchCatalogue(env, token, { search: message, limit: 15 });
    const context = (rows || []).map(r => ({
      code: r.code || r.part_id || null,
      part_id: r.part_id || null,
      identifying_features: r.identifying_features || null,
      usage_side: r.usage_side || null,
      view_mode: r.view_mode || null,
      description: r.description || r.notes || null
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
          `\n\nTrả JSON đúng cấu trúc:\n` +
          `{"top5":[{"rank":1,"code":"...","part_id":"...","match_reason":"lý do khớp ngắn gọn","confidence":"high|medium|low"}],"answer":"câu trả lời tiếng Việt tự nhiên, ngắn gọn"}`
      }
    ];

    const result = await callJson(env, "orchestrator", messages, {
      temperature: 0.3,
      maxTokens: 2048,
      responseFormat: { type: "json_object" }
    });

    const parsed = result.json || {};
    const top5 = Array.isArray(parsed.top5) ? parsed.top5 : [];
    const answer = String(parsed.answer || result.content || "").trim();

    return json({
      ok: true,
      engine: "kim-v6-chat",
      answer,
      top5,
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