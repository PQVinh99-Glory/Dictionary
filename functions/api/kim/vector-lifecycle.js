import { readKimConfig } from "../../_lib/kim/v5/runtime/config.js";
import { validateSession, rpc } from "../../_lib/kim/v5/connectors/supabase.js";
import { json, errorResponse } from "../../_lib/shared/http.js";

export async function onRequestGet({request,env}) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("session_token") || "";
    const me = await validateSession(env, token);
    const config = readKimConfig(env);

    const data = await rpc(env, "kim_vector_reindex_status", {
      p_embedding_model:config.vector.model,
      p_embedding_model_version:config.vector.modelVersion,
      p_preprocess_version:config.vector.preprocessVersion,
      p_embedding_profile:config.vector.profile
    });

    const status = Array.isArray(data) ? data[0] || {} : data || {};

    return json({
      ok:true,
      user:{
        role_name:me?.role_name || null
      },
      lifecycle:{
        browser_encoder_enabled:true,
        vector_search_enabled:config.features.vectorSearch,
        service_role_configured:!!env.SUPABASE_SERVICE_ROLE_KEY,
        vector_ready:
          config.features.vectorSearch &&
          Number(status.active_vectors || 0) > 0
      },
      profile:{
        model:config.vector.model,
        model_version:config.vector.modelVersion,
        preprocess_version:config.vector.preprocessVersion,
        embedding_profile:config.vector.profile,
        dimension:config.vector.dimension
      },
      coverage:status
    });
  } catch (error) {
    return errorResponse(error);
  }
}
