import { readKimConfig } from "../../_lib/kim/v5/runtime/config.js";
import { rpc, validateSession } from "../../_lib/kim/v5/connectors/supabase.js";
import { json, errorResponse } from "../../_lib/shared/http.js";

export async function onRequestGet({request,env}) {
  try {
    const config = readKimConfig(env);
    const url = new URL(request.url);
    const token = url.searchParams.get("session_token") || "";

    await validateSession(env, token);

    const data = await rpc(env, "kim_vector_reindex_status", {
      p_embedding_model:config.vector.model,
      p_embedding_model_version:config.vector.modelVersion,
      p_preprocess_version:config.vector.preprocessVersion,
      p_embedding_profile:config.vector.profile
    });

    return json({
      ok:true,
      profile:{
        model:config.vector.model,
        model_version:config.vector.modelVersion,
        preprocess_version:config.vector.preprocessVersion,
        embedding_profile:config.vector.profile
      },
      status:Array.isArray(data) ? data[0] || {} : data || {}
    });
  } catch (error) {
    return errorResponse(error);
  }
}
