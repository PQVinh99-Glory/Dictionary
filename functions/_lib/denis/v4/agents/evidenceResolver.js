import { callGeminiJson, dataUrlPart } from "../providers/gemini.js";
import { callOpenRouterJson } from "../providers/openrouter.js";
import { resolverPrompt, metadataResolverPrompt } from "../memory/prompts.js";
import { RANKING_SCHEMA } from "../schemas/ranking.js";
import { r2ImageDataUrl, preferredImagePath } from "../connectors/r2.js";

function candidateMeta(row) {
  return {
    candidate_id:String(row.id),
    code:row.code || null,
    part_id:row.part_id || null,
    usage_side:row.usage_side || "unknown",
    is_symmetric:!!row.is_symmetric,
    identifying_features:row.identifying_features || null,
    confusing_note:row.confusing_note || null
  };
}

export async function resolveImageCandidates(env, {
  model,
  timeoutMs,
  message,
  signature,
  queryImage,
  candidates
}) {
  const parts = [
    {text:"CURRENT QUERY IMAGE:"},
    dataUrlPart(queryImage),
    {text:`SUPPLIED CANDIDATE POOL:\n${JSON.stringify(candidates.map(candidateMeta))}`}
  ];

  for (const row of candidates) {
    parts.push({text:`CANDIDATE ${String(row.id)} — ${row.code || ""}`});

    const dataUrl = await r2ImageDataUrl(
      env,
      preferredImagePath(row),
      {maxBytes:1_200_000}
    ).catch(() => null);

    if (dataUrl) {
      parts.push(dataUrlPart(dataUrl));
    } else {
      parts.push({text:"Candidate image unavailable; treat visual evidence as UNKNOWN."});
    }
  }

  return await callGeminiJson(env, {
    model,
    timeoutMs,
    schema:RANKING_SCHEMA,
    systemInstruction:resolverPrompt(message,signature),
    parts
  });
}

export async function resolveTextCandidates(env, {
  model,
  timeoutMs,
  message,
  candidates
}) {
  return await callOpenRouterJson(env, {
    model,
    timeoutMs,
    schema:RANKING_SCHEMA,
    schemaName:"denis_metadata_resolver",
    messages:[
      {role:"system",content:metadataResolverPrompt(message)},
      {
        role:"user",
        content:JSON.stringify({
          candidate_pool:candidates.map(candidateMeta)
        })
      }
    ]
  });
}
