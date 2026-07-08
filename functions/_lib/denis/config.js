export const DEFAULT_MODELS = {
  planner: "google/gemma-4-26b-a4b-it:free",
  vision: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  judge: "google/gemma-4-31b-it:free"
};

function bool(value, fallback=false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1","true","yes","on"].includes(String(value).toLowerCase());
}

function int(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function getDenisConfig(env) {
  return {
    openrouterApiKey: String(env.OPENROUTER_API_KEY || ""),
    plannerModel: String(env.DENIS_MODEL_PLANNER || DEFAULT_MODELS.planner),
    visionModel: String(env.DENIS_MODEL_VISION || DEFAULT_MODELS.vision),
    judgeModel: String(env.DENIS_MODEL_JUDGE || DEFAULT_MODELS.judge),
    judgeEnabled: bool(env.DENIS_JUDGE_ENABLED, true),
    maxCandidates: int(env.DENIS_MAX_CANDIDATES, 12, 4, 30),
    verifyTopK: int(env.DENIS_VERIFY_TOP_K, 4, 2, 6),
    maxScanRows: int(env.DENIS_MAX_SCAN_ROWS, 1500, 100, 5000),
    openrouterTimeoutMs: int(env.DENIS_OPENROUTER_TIMEOUT_MS, 30000, 5000, 60000),
    appName: String(env.OPENROUTER_APP_NAME || "Denis Catalogue AI"),
    httpReferer: String(env.OPENROUTER_HTTP_REFERER || "")
  };
}
