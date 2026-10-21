import { boolEnv, boundedInt } from "../../../shared/validation.js";

export function readMorisConfig(env) {
  return {
    enabled:boolEnv(env.MORIS_ENABLED, true),

    features:{
      // M22 development ablation lost four Top1 hits; require new acceptance evidence.
      geometryVerification:false,
      // Experimental verifier remains OFF until M22 demonstrates benefit.
      contourVerification:false,
      spatialVerification:false,
      vectorSearch:boolEnv(env.MORIS_VECTOR_SEARCH_ENABLED, false),
      // M28 Size Gate (S1): chỉ tác động khi query có size; fail-open khi thiếu dims.
      sizeGate:boolEnv(env.MORIS_SIZE_GATE_ENABLED, true),
      // P06/P08 requires the reviewed scoped RPC; keep off until deployed/verified.
      scopedSizeSearch:boolEnv(env.MORIS_SCOPED_SIZE_SEARCH_ENABLED, false),
      keyedHydration:boolEnv(env.MORIS_KEYED_HYDRATION_ENABLED, false),
      // Từ điển mẫu lỗ (2026-10-19): boost MỀM khi định dạng lỗ query khớp mô tả
      // identifying_features. Mặc định OFF — chỉ bật sau khi đo trên dữ liệu thật.
      holeFormatBoost:boolEnv(env.MORIS_HOLE_FORMAT_BOOST_ENABLED, false)
    },

    vector:{
      model:String(env.MORIS_VECTOR_MODEL || "onnx-community/dinov2-small"),
      modelVersion:String(env.MORIS_VECTOR_MODEL_VERSION || "ef1fb10"),
      preprocessVersion:String(env.MORIS_PREPROCESS_VERSION || "kim_canon_v3_letterbox"),
      profile:String(env.MORIS_EMBEDDING_PROFILE || "hybrid_gem3_edge_55_45_pseudorgb_u8_v1"),
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
