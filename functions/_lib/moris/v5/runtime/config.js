import { boolEnv, boundedInt } from "../../../shared/validation.js";

export function readMorisConfig(env) {
  return {
    enabled:boolEnv(env.MORIS_ENABLED, true),

    features:{
      vectorSearch:boolEnv(env.MORIS_VECTOR_SEARCH_ENABLED, false)
    },

    vector:{
      model:String(env.MORIS_VECTOR_MODEL || "onnx-community/dinov2-small"),
      modelVersion:String(env.MORIS_VECTOR_MODEL_VERSION || "ef1fb10"),
      preprocessVersion:String(env.MORIS_PREPROCESS_VERSION || "kim_canon_v2"),
      profile:String(env.MORIS_EMBEDDING_PROFILE || "cls_l2_v1"),
      dimension:boundedInt(env.MORIS_VECTOR_DIMENSION, 384, 8, 4096),
      topK:boundedInt(env.MORIS_VECTOR_TOP_K, 60, 5, 100),
      resolverK:boundedInt(env.MORIS_RESOLVER_TOP_K, 10, 2, 20),
      minSimilarity:Number(env.MORIS_VECTOR_MIN || 0.55)
    },

    limits:{
      maxScanRows:boundedInt(env.MORIS_MAX_SCAN_ROWS, 1500, 100, 10000),
      maxImageDataUrlChars:boundedInt(env.MORIS_MAX_IMAGE_DATA_URL_CHARS, 4_000_000, 100_000, 12_000_000)
    },

    endpoints:{
      embedding:String(env.MORIS_EMBEDDING_ENDPOINT || ""),
      foreground:String(env.MORIS_FOREGROUND_ENDPOINT || "")
    }
  };
}
