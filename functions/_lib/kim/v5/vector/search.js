import { rpc } from "../connectors/supabase.js";

function vectorLiteral(vector) {
  return `[${Array.from(vector).map(v => Number(v).toFixed(8)).join(",")}]`;
}

export async function searchVectorIndex(env, config, vector, matchCount) {
  const data = await rpc(env, "match_catalogue_image_vectors", {
    p_query_embedding:vectorLiteral(vector),
    p_embedding_model:config.vector.model,
    p_embedding_model_version:config.vector.modelVersion,
    p_preprocess_version:config.vector.preprocessVersion,
    p_embedding_profile:config.vector.profile,
    p_match_count:Math.max(1, Math.min(Number(matchCount || config.vector.topK), 100))
  });

  return Array.isArray(data) ? data : [];
}
