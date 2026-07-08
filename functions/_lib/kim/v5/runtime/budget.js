export function createBudget(config) {
  return {
    gemini:0,
    openrouter:0,
    consume(provider) {
      if (provider === "gemini") {
        if (this.gemini >= config.ai.maxGeminiCalls) {
          const e = new Error("Vượt ngân sách Gemini của query.");
          e.status = 429;
          throw e;
        }
        this.gemini += 1;
        return;
      }

      if (provider === "openrouter") {
        if (this.openrouter >= config.ai.maxOpenRouterCalls) {
          const e = new Error("Vượt ngân sách OpenRouter của query.");
          e.status = 429;
          throw e;
        }
        this.openrouter += 1;
      }
    },
    snapshot() {
      return {gemini:this.gemini,openrouter:this.openrouter};
    }
  };
}
