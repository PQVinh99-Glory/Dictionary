export function readModels(env) {
  return {
    gemini:String(env.DENIS_GEMINI_MODEL || "gemini-3.5-flash"),
    gemma:String(env.DENIS_GEMMA_MODEL || "google/gemma-4-31b-it:free")
  };
}
