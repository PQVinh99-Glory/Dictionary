import { readMorisConfig } from "../../_lib/moris/v5/runtime/config.js";
import { json } from "../../_lib/shared/http.js";

export async function onRequestGet({env}) {
  const config=readMorisConfig(env);
  return json({
    ok:true,
    service:"moris-v1.0",
    enabled:config.enabled,
    vector_search_enabled:config.features.vectorSearch,
    query_vector_bridge_ready:
      config.enabled === true && config.features.vectorSearch === true,
    vector_profile:{
      model:config.vector.model,
      model_version:config.vector.modelVersion,
      preprocess_version:config.vector.preprocessVersion,
      profile:config.vector.profile,
      dimension:config.vector.dimension
    }
  });
}
