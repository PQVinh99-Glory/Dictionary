export function validateKimQuery(body, config) {
  const message = String(body?.message || "").trim();
  const image = String(body?.image_data_url || "");
  const embedding = body?.query_embedding;

  if (!message && !image && !Array.isArray(embedding)) {
    const e = new Error("Cần message, image_data_url hoặc query_embedding.");
    e.status = 400;
    throw e;
  }

  if (image && image.length > config.limits.maxImageDataUrlChars) {
    const e = new Error("image_data_url quá lớn.");
    e.status = 413;
    throw e;
  }

  return {
    query_id:String(body?.query_id || crypto.randomUUID()),
    message,
    image_data_url:image,
    query_embedding:Array.isArray(embedding) ? embedding : null,
    embedding_profile:body?.embedding_profile || null,
    filters:{
      usage_side:body?.filters?.usage_side || "all",
      view_mode:body?.filters?.view_mode || "all"
    },
    hints:body?.hints || {}
  };
}
