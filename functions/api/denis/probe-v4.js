import { callGeminiJson } from "../../_lib/denis/v4/providers/gemini.js";
import { callOpenRouterJson } from "../../_lib/denis/v4/providers/openrouter.js";

const PING_SCHEMA = {
  type:"object",
  additionalProperties:false,
  properties:{
    status:{type:"string",enum:["ok"]},
    provider:{type:"string"}
  },
  required:["status","provider"]
};

function json(data,status=200) {
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

export async function onRequestGet({request,env}) {
  const provider = new URL(request.url).searchParams.get("provider") || "gemini";
  const started = Date.now();

  try {
    if (provider === "openrouter") {
      const model = env.DENIS_GEMMA_MODEL || "google/gemma-4-31b-it:free";
      const output = await callOpenRouterJson(env,{
        model,
        timeoutMs:Number(env.DENIS_OPENROUTER_TIMEOUT_MS || 30000),
        schema:PING_SCHEMA,
        schemaName:"denis_probe",
        maxTokens:50,
        messages:[
          {role:"system",content:"Return status=ok and provider=openrouter."},
          {role:"user",content:"Probe."}
        ]
      });

      return json({
        ok:true,
        provider,
        model,
        latency_ms:Date.now()-started,
        output
      });
    }

    const model = env.DENIS_GEMINI_MODEL || "gemini-3.5-flash";
    const output = await callGeminiJson(env,{
      model,
      timeoutMs:Number(env.DENIS_GEMINI_TIMEOUT_MS || 60000),
      schema:PING_SCHEMA,
      maxOutputTokens:50,
      systemInstruction:"Return status=ok and provider=gemini.",
      parts:[{text:"Probe."}]
    });

    return json({
      ok:true,
      provider:"gemini",
      model,
      latency_ms:Date.now()-started,
      output
    });
  } catch (e) {
    return json({
      ok:false,
      provider,
      latency_ms:Date.now()-started,
      message:e?.message || "probe failed"
    },Number(e?.status) || 502);
  }
}
