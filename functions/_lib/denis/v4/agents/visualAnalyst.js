import { callGeminiJson, dataUrlPart } from "../providers/gemini.js";
import { callOpenRouterJson } from "../providers/openrouter.js";
import { visualAnalystPrompt } from "../memory/prompts.js";
import { VISUAL_SIGNATURE_SCHEMA } from "../schemas/visualSignature.js";

export async function visualAnalystGemini(env, {model,timeoutMs,message,queryImage}) {
  return await callGeminiJson(env, {
    model,
    timeoutMs,
    schema:VISUAL_SIGNATURE_SCHEMA,
    systemInstruction:visualAnalystPrompt(message),
    parts:[
      {text:"Analyze the current query image now."},
      dataUrlPart(queryImage)
    ]
  });
}

export async function visualAnalystGemmaFallback(env, {model,timeoutMs,message,queryImage}) {
  return await callOpenRouterJson(env, {
    model,
    timeoutMs,
    schema:VISUAL_SIGNATURE_SCHEMA,
    schemaName:"denis_visual_signature",
    messages:[
      {role:"system",content:visualAnalystPrompt(message)},
      {
        role:"user",
        content:[
          {type:"text",text:"Analyze the current query image now."},
          {type:"image_url",image_url:{url:queryImage}}
        ]
      }
    ]
  });
}
