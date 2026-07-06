import { getDenisConfig } from "../../_lib/denis/config.js";
import { callOpenRouter, extractText } from "../../_lib/denis/openrouter.js";

const HEADERS = {
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff"
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {status, headers:HEADERS});
}

export async function onRequestGet({env}) {
  const config = getDenisConfig(env);

  if (!config.openrouterApiKey) {
    return json({
      ok:false,
      stage:"config",
      status:"missing_openrouter_key"
    }, 503);
  }

  const startedAt = Date.now();

  try {
    const completion = await callOpenRouter(config, {
      model:config.plannerModel,
      messages:[
        {role:"system", content:"You are a health probe. Reply with exactly OK."},
        {role:"user", content:"Reply exactly OK"}
      ],
      temperature:0,
      maxTokens:8
    });

    return json({
      ok:true,
      stage:"upstream",
      status:"reachable",
      model:config.plannerModel,
      latency_ms:Date.now() - startedAt,
      reply:extractText(completion).trim().slice(0,80)
    });
  } catch (e) {
    return json({
      ok:false,
      stage:"upstream",
      status:"failed",
      model:config.plannerModel,
      latency_ms:Date.now() - startedAt,
      message:e?.message || "OpenRouter probe failed."
    }, Number(e?.status) || 502);
  }
}
