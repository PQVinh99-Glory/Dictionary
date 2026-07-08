function assertEmbedding(vector,dimension,label){
  if(!Array.isArray(vector) || vector.length!==dimension){
    const e=new Error(`${label} phải đúng ${dimension} chiều.`);
    e.status=400; throw e;
  }
  for(const value of vector){
    if(!Number.isFinite(Number(value))){
      const e=new Error(`${label} chứa giá trị không hợp lệ.`);
      e.status=400; throw e;
    }
  }
  return vector.map(Number);
}

export function validateKimQuery(body, config) {
  const message = String(body?.message || "").trim();
  const image = String(body?.image_data_url || "");
  const embedding = body?.query_embedding;
  const probes = Array.isArray(body?.query_embeddings)
    ? body.query_embeddings.slice(0,3)
    : [];

  if (!message && !image && !Array.isArray(embedding) && !probes.length) {
    const e = new Error("Cần message, image_data_url hoặc query embedding.");
    e.status = 400;
    throw e;
  }

  if (image && image.length > config.limits.maxImageDataUrlChars) {
    const e = new Error("image_data_url quá lớn.");
    e.status = 413;
    throw e;
  }

  const queryEmbedding = Array.isArray(embedding)
    ? assertEmbedding(embedding,config.vector.dimension,'query_embedding')
    : null;

  const queryEmbeddings = probes.map((probe,index)=>({
    probe_id:String(probe?.probe_id || `probe_${index+1}`).slice(0,40),
    embedding:assertEmbedding(
      probe?.embedding,
      config.vector.dimension,
      `query_embeddings[${index}]`
    ),
    embedding_profile:probe?.embedding_profile || body?.embedding_profile || null
  }));

  return {
    query_id:String(body?.query_id || crypto.randomUUID()),
    message,
    image_data_url:image,
    query_embedding:queryEmbedding,
    query_embeddings:queryEmbeddings,
    embedding_profile:body?.embedding_profile || null,
    filters:{
      usage_side:body?.filters?.usage_side || "all",
      view_mode:body?.filters?.view_mode || "all"
    },
    hints:body?.hints || {}
  };
}
