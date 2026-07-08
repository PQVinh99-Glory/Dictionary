import { readKimConfig } from "../../_lib/kim/v5/runtime/config.js";
import { json } from "../../_lib/shared/http.js";

export async function onRequestGet({env}) {
  const config = readKimConfig(env);

  return json({
    ok:true,
    service:"thu-ky-kim-v5.5",
    architecture:"browser-dinov2-vector-harness",

    enabled:config.enabled,
    features:config.features,

    vector:{
      client_embedding_ready:
        config.features.vectorSearch === true,

      server_embedding_endpoint_configured:
        !!config.endpoints.embedding,

      model:config.vector.model,
      model_version:config.vector.modelVersion,
      preprocess_version:config.vector.preprocessVersion,
      profile:config.vector.profile,
      dimension:config.vector.dimension,
      top_k:config.vector.topK,
      min_similarity:config.vector.minSimilarity,

      browser_runtime:{
        library:"@huggingface/transformers@3.8.1",
        preferred:"webgpu/fp16",
        fallback:"wasm/q8"
      }
    },

    foreground:{
      endpoint_configured:!!config.endpoints.foreground,
      upload_remove_bg_existing:true
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

    vector_write:{
      service_role_configured:
        !!env.SUPABASE_SERVICE_ROLE_KEY
    },

    next_action:
      config.features.vectorSearch
        ? "Run browser reindex, then test Recall@30."
        : "Enable KIM_VECTOR_SEARCH_ENABLED after SQL and reindex are ready."
  });
}
