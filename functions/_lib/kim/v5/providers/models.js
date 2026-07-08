export function readKimModels(env, config) {
  return {
    gemini:String(env.KIM_GEMINI_MODEL || config.ai.geminiModel),
    gemma:String(env.KIM_GEMMA_MODEL || config.ai.gemmaModel)
  };
}
