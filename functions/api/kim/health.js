import { readKimConfig } from "../../_lib/kim/v5/runtime/config.js";
import { json } from "../../_lib/shared/http.js";

export async function onRequestGet({env}) {
  const config = readKimConfig(env);

  const vectorReady =
    config.features.vectorSearch &&
    !!config.endpoints.embedding;

  return json({
    ok:true,
    service:"thu-ky-kim-v5",
    architecture:"hybrid-vector-vision",

    enabled:config.enabled,
    features:config.features,

    vector:{
      ready:vectorReady,
      model:config.vector.model,
      model_version:config.vector.modelVersion,
      preprocess_version:config.vector.preprocessVersion,
      profile:config.vector.profile,
      dimension:config.vector.dimension,
      top_k:config.vector.topK,
      min_similarity:config.vector.minSimilarity,

      feature_flag_enabled:
        config.features.vectorSearch,

      embedding_endpoint_configured:
        !!config.endpoints.embedding
    },

    foreground:{
      endpoint_configured:
        !!config.endpoints.foreground
    },

    providers:{
      gemini:{
        configured:!!env.GEMINI_API_KEY,
        enabled:config.features.geminiRerank,
        model:config.ai.geminiModel
      },

      openrouter:{
        configured:!!env.OPENROUTER_API_KEY,
        enabled:config.features.gemmaJudge,
        model:config.ai.gemmaModel
      }
    },

    next_action:vectorReady
      ? "Test vector index rows and Recall@30."
      : (
          !config.features.vectorSearch
            ? "Enable KIM_VECTOR_SEARCH_ENABLED after vector index is ready."
            : "Configure KIM_EMBEDDING_ENDPOINT or send query_embedding from client."
        )
  });
}
