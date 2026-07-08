export function assertAiBudget(snapshot, config) {
  if (Number(snapshot?.gemini || 0) > config.ai.maxGeminiCalls) {
    throw new Error("Gemini budget invariant bị vi phạm.");
  }

  if (Number(snapshot?.openrouter || 0) > config.ai.maxOpenRouterCalls) {
    throw new Error("OpenRouter budget invariant bị vi phạm.");
  }

  return true;
}
