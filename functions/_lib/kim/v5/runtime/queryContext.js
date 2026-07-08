import { sha256Hex, stableHash } from "../../../shared/hash.js";

export async function createQueryContext({
  queryId,
  message,
  imageDataUrl,
  filters,
  config
}) {
  const id = String(queryId || crypto.randomUUID());
  const imageHash = imageDataUrl ? await sha256Hex(imageDataUrl) : "";
  const filterHash = await stableHash(filters || {});

  return {
    query_id:id,
    image_hash:imageHash,
    filter_hash:filterHash,
    started_at:new Date().toISOString(),
    stage:"created",
    embedding_profile:{
      model:config.vector.model,
      model_version:config.vector.modelVersion,
      preprocess_version:config.vector.preprocessVersion,
      profile:config.vector.profile,
      dimension:config.vector.dimension
    },
    ai_calls:{gemini:0,openrouter:0},
    warnings:[],
    trace:[]
  };
}
