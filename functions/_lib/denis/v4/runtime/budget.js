export function readBudget(env) {
  return {
    maxTotal:Number(env.DENIS_MAX_AI_CALLS_PER_QUERY || 3),
    maxGemini:Number(env.DENIS_MAX_GEMINI_CALLS_PER_QUERY || 2),
    maxOpenRouter:Number(env.DENIS_MAX_OPENROUTER_CALLS_PER_QUERY || 1),
    maxCandidateImages:Number(env.DENIS_MAX_CANDIDATE_IMAGES || 10),
    maxCandidatePool:Number(env.DENIS_MAX_CANDIDATE_POOL || 24),
    maxScanRows:Number(env.DENIS_MAX_SCAN_ROWS || 1500),
    geminiTimeoutMs:Number(env.DENIS_GEMINI_TIMEOUT_MS || 60000),
    openrouterTimeoutMs:Number(env.DENIS_OPENROUTER_TIMEOUT_MS || 30000),
    ambiguityGap:Number(env.DENIS_AMBIGUITY_GAP || 0.08)
  };
}

export function consume(ctx, budget, provider, agentName) {
  if (ctx.ai_calls.total >= budget.maxTotal) {
    const e = new Error(`AI call budget exceeded before ${agentName}.`);
    e.status = 429;
    throw e;
  }

  if (provider === "gemini" && ctx.ai_calls.gemini >= budget.maxGemini) {
    const e = new Error(`Gemini call budget exceeded before ${agentName}.`);
    e.status = 429;
    throw e;
  }

  if (provider === "openrouter" && ctx.ai_calls.openrouter >= budget.maxOpenRouter) {
    const e = new Error(`OpenRouter call budget exceeded before ${agentName}.`);
    e.status = 429;
    throw e;
  }

  ctx.ai_calls.total += 1;
  ctx.ai_calls[provider] += 1;
  ctx.agents_run.push(agentName);
}
