export function readKimConfig(env) {
  return {
    vector:{
      model:env.KIM_VECTOR_MODEL || "dinov2_vits14",
      modelVersion:env.KIM_VECTOR_MODEL_VERSION || "1",
      preprocessVersion:env.KIM_PREPROCESS_VERSION || "kim_fg_v1",
      profile:env.KIM_EMBEDDING_PROFILE || "cls_l2_v1",
      topK:Number(env.KIM_VECTOR_TOP_K || 30),
      resolverK:Number(env.KIM_RESOLVER_TOP_K || 10)
    },
    ai:{
      geminiModel:env.KIM_GEMINI_MODEL || "gemini-3.5-flash",
      gemmaModel:env.KIM_GEMMA_MODEL || "google/gemma-4-31b-it:free",
      maxGeminiCalls:Number(env.KIM_MAX_GEMINI_CALLS || 1),
      maxOpenRouterCalls:Number(env.KIM_MAX_OPENROUTER_CALLS || 1)
    },
    gates:{
      vectorMin:Number(env.KIM_VECTOR_MIN || 0.55),
      ambiguityGap:Number(env.KIM_AMBIGUITY_GAP || 0.035),
      judgeGap:Number(env.KIM_JUDGE_GAP || 0.05)
    }
  };
}
