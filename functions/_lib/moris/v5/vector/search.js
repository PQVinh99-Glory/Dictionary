import { rpcService } from "../connectors/supabaseService.js";

function vectorLiteral(vector) {
  return `[${Array.from(vector).map(v => Number(v).toFixed(8)).join(",")}]`;
}

export async function searchVectorIndex(env, config, vector, matchCount, { onRpc } = {}) {
  const matchK = Math.max(
    1,
    Math.min(Number(matchCount || config.vector.topK), 100)
  );
  const vecStr = vectorLiteral(vector);

  const callRpc = async (fnName, model, modelVersion, preprocessVersion, profile) => {
    try {
      const rows = await rpcService(env, fnName, {
      p_query_embedding: vecStr,
      p_embedding_model: model,
      p_embedding_model_version: modelVersion,
      p_preprocess_version: preprocessVersion,
      p_embedding_profile: profile,
      p_match_count: matchK
      });
      onRpc?.({rpc:fnName,status:'ok',count:Array.isArray(rows)?rows.length:0});
      return rows;
    } catch (error) {
      onRpc?.({rpc:fnName,status:'error',code:String(error?.code || 'RPC_ERROR')});
      throw error;
    }
  };

  let data = null;
  try {
    data = await callRpc(
      "match_catalogue_image_vectors_v6",
      config.vector.model,
      config.vector.modelVersion,
      config.vector.preprocessVersion,
      config.vector.profile
    );
  } catch {
    // Fallback to production RPC if v6 migration is not applied
    try {
      data = await callRpc(
        "match_catalogue_image_vectors",
        config.vector.model,
        config.vector.modelVersion,
        config.vector.preprocessVersion,
        config.vector.profile
      );
    } catch (e) {
      console.warn("searchVectorIndex RPC failed:", e?.message);
    }
  }

  return Array.isArray(data) ? data : [];
}

/** Reviewed read-only proposal RPC. Never reuse global ANN scores for scoped IDs. */
export async function searchScopedVectorIndex(env, config, vector, recordIds, matchCount, {onRpc} = {}) {
  const ids = [...new Set((recordIds || []).map(String))].filter(id => /^[a-z0-9-]{1,64}$/i.test(id));
  if (!ids.length || ids.length > 2000) return {status:'invalid_scope', hits:[]};
  try {
    const rows = await rpcService(env, 'match_catalogue_image_vectors_scoped_v1', {
      p_query_embedding: vectorLiteral(vector),
      p_embedding_model: config.vector.model,
      p_embedding_model_version: config.vector.modelVersion,
      p_preprocess_version: config.vector.preprocessVersion,
      p_embedding_profile: config.vector.profile,
      p_record_ids: ids,
      p_match_count: Math.max(1, Math.min(100, Number(matchCount) || 100))
    });
    if (!Array.isArray(rows)) return {status:'invalid_response', hits:[]};
    onRpc?.({rpc:'match_catalogue_image_vectors_scoped_v1',status:'ok',count:rows.length});
    return {status:'ok', hits:rows};
  } catch (error) {
    onRpc?.({rpc:'match_catalogue_image_vectors_scoped_v1',status:'error',code:String(error?.code || error?.status || 'RPC_ERROR')});
    return {status:'unavailable', hits:[]};
  }
}
