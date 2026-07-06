import { DEFAULT_MODELS, getDenisConfig } from "../../_lib/denis/config.js";

export async function onRequestGet({env}) {
  const config = getDenisConfig(env);
  const body = {
    ok:!!config.openrouterApiKey,
    service:"denis-catalogue-ai",
    status:config.openrouterApiKey ? "configured" : "missing_openrouter_key",
    models:{
      planner:config.plannerModel,
      vision:config.visionModel,
      judge:config.judgeModel
    },
    judge_enabled:config.judgeEnabled,
    defaults:DEFAULT_MODELS
  };

  return new Response(JSON.stringify(body), {
    status:config.openrouterApiKey ? 200 : 503,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff"
    }
  });
}
