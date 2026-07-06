import { runDenis } from "../../_lib/denis/harness.js";

const HEADERS = {
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff"
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {status, headers:HEADERS});
}

function validImageDataUrl(value) {
  if (!value) return null;
  const text = String(value);
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(text)) {
    throw new Error("Ảnh query phải là JPEG, PNG hoặc WebP data URL.");
  }
  // ~4 MB string ceiling. Frontend targets <= 3 MB binary.
  if (text.length > 4_500_000) throw new Error("Ảnh query quá lớn.");
  return text;
}

export async function onRequestPost({request, env}) {
  try {
    const token = request.headers.get("x-session-token") || "";
    const body = await request.json().catch(() => null);
    if (!body) return json({ok:false, message:"JSON body không hợp lệ."}, 400);

    const message = String(body.message || "").trim();
    const imageDataUrl = validImageDataUrl(body.image_data_url || null);
    if (!message && !imageDataUrl) {
      return json({ok:false, message:"Cần câu hỏi hoặc ảnh query."}, 400);
    }
    if (message.length > 4000) {
      return json({ok:false, message:"Câu hỏi quá dài."}, 413);
    }

    const conversation = Array.isArray(body.conversation)
      ? body.conversation.slice(-8).map(x => ({
          role:x?.role === "assistant" ? "assistant" : "user",
          content:String(x?.content || "").slice(0,1800)
        }))
      : [];

    const result = await runDenis(env, {
      token,
      message:message || "Phân tích ảnh này và tìm linh kiện phù hợp trong thư viện.",
      imageDataUrl,
      conversation
    });

    return json({ok:true, ...result});
  } catch (e) {
    console.error("Denis chat failed", e?.stack || e?.message || String(e));
    return json({
      ok:false,
      message:e?.message || "Denis chưa xử lý được yêu cầu."
    }, Number(e?.status) || 500);
  }
}
