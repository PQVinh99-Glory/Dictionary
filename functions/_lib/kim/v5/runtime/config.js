import { boolEnv, boundedInt } from "../../../shared/validation.js";

export function readKimConfig(env) {
  return {
    enabled:boolEnv(env.KIM_ENABLED, true),

    features:{
      vectorSearch:boolEnv(env.KIM_VECTOR_SEARCH_ENABLED, false),
      geminiRerank:boolEnv(env.KIM_GEMINI_RERANK_ENABLED, false),
      gemmaJudge:boolEnv(env.KIM_GEMMA_JUDGE_ENABLED, false),
      v4Rollback:boolEnv(env.KIM_V4_ROLLBACK_ENABLED, true)
    },

    vector:{
      model:String(env.KIM_VECTOR_MODEL || "onnx-community/dinov2-small"),
      modelVersion:String(env.KIM_VECTOR_MODEL_VERSION || "ef1fb10"),
      preprocessVersion:String(env.KIM_PREPROCESS_VERSION || "hf_dinov2_224_v1"),
      profile:String(env.KIM_EMBEDDING_PROFILE || "cls_l2_v1"),
      dimension:boundedInt(env.KIM_VECTOR_DIMENSION, 384, 8, 4096),
      topK:boundedInt(env.KIM_VECTOR_TOP_K, 30, 5, 100),
      resolverK:boundedInt(env.KIM_RESOLVER_TOP_K, 10, 2, 20),
      minSimilarity:Number(env.KIM_VECTOR_MIN || 0.55)
    },

    ai:{
      geminiModel:String(env.KIM_GEMINI_MODEL || "gemini-3.5-flash"),
      gemmaModel:String(env.KIM_GEMMA_MODEL || "google/gemma-4-31b-it:free"),
      maxGeminiCalls:boundedInt(env.KIM_MAX_GEMINI_CALLS, 1, 0, 2),
      maxOpenRouterCalls:boundedInt(env.KIM_MAX_OPENROUTER_CALLS, 1, 0, 2),
      geminiTimeoutMs:boundedInt(env.KIM_GEMINI_TIMEOUT_MS, 60000, 5000, 120000),
      openRouterTimeoutMs:boundedInt(env.KIM_OPENROUTER_TIMEOUT_MS, 30000, 5000, 120000)
    },

    gates:{
      ambiguityGap:Number(env.KIM_AMBIGUITY_GAP || 0.035),
      judgeGap:Number(env.KIM_JUDGE_GAP || 0.05)
    },

    limits:{
      maxScanRows:boundedInt(env.KIM_MAX_SCAN_ROWS, 1500, 100, 10000),
      maxImageDataUrlChars:boundedInt(env.KIM_MAX_IMAGE_DATA_URL_CHARS, 4_000_000, 100_000, 12_000_000)
    },

    endpoints:{
      embedding:String(env.KIM_EMBEDDING_ENDPOINT || ""),
      foreground:String(env.KIM_FOREGROUND_ENDPOINT || "")
    }
  };
}
