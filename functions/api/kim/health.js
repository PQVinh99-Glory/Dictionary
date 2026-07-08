import { readKimConfig } from "../../_lib/kim/v5/runtime/config.js";
import { json } from "../../_lib/shared/http.js";

export async function onRequestGet({env}) {
  const config = readKimConfig(env);

  const serviceRoleConfigured =
    !!env.SUPABASE_SERVICE_ROLE_KEY ||
    !!env.SUPABASE_SECRET_KEY;

  return json({
    ok:true,
    service:"thu-ky-kim-v5.8",
    architecture:
      "query-vector-bridge-auto-embed-queue-chunked-backfill",

    enabled:config.enabled,
    features:config.features,

    query_vector_bridge:{
      browser_encoder_available:true,
      vector_search_enabled:
        config.features.vectorSearch === true,
      ready:
        config.enabled === true &&
        config.features.vectorSearch === true
    },

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
      resolver_top_k:config.vector.resolverK,
      min_similarity:config.vector.minSimilarity,

      browser_runtime:{
        library:"@huggingface/transformers@3.8.1",
        preferred:"webgpu/fp16",
        fallback:"wasm/q8"
      }
    },

    auto_embed_queue:{
      enabled:true,
      persistent:true,
      server_chunk_limit:20
    },

    vector_write:{
      service_role_configured:
        serviceRoleConfigured,
      max_vectors_per_request:20,
      chunked_client_required:true
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

    next_action:
      !config.features.vectorSearch
        ? "Set KIM_VECTOR_SEARCH_ENABLED=true, redeploy, then test image query."
        : "Test raw image Recall@30; enable Gemini then Gemma conditionally."
  });
}
