import { runDenisSearch } from "../../_lib/denis/searchHarness.js";

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
    const topK = Math.max(1, Math.min(8, Number(body.top_k || 5)));

    if (!message && !imageDataUrl) {
      return json({ok:false, message:"Cần mô tả hoặc ảnh query."}, 400);
    }

    const result = await runDenisSearch(env, {
      token,
      message,
      imageDataUrl,
      topK
    });

    return json({ok:true, ...result});
  } catch (e) {
    console.error("Denis search failed", e?.stack || e?.message || String(e));
    return json({
      ok:false,
      message:e?.message || "Denis Search chưa xử lý được yêu cầu."
    }, Number(e?.status) || 500);
  }
}
