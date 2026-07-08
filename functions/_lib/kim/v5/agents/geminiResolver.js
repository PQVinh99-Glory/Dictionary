import { callGeminiJson, geminiImagePart } from "../providers/gemini.js";
import { GEMINI_RESOLVER_SYSTEM } from "../prompts/geminiResolver.js";
import { RANKING_SCHEMA } from "../schemas/ranking.js";
import { r2ImageDataUrl, preferredImagePath } from "../connectors/r2.js";

export async function resolveWithGemini(env, config, {
  query,
  prep,
  candidates,
  budget
}) {
  budget.consume("gemini");

  const parts = [
    {text:JSON.stringify({
      task:"rank_supplied_candidates_only",
      query_text:query.message || "",
      candidates:(candidates || []).map(c => ({
        candidate_id:String(c?.id ?? c?.record_id),
        code:c?.code ?? null,
        part_id:c?.part_id ?? null,
        identifying_features:c?.identifying_features ?? null,
        confusing_note:c?.confusing_note ?? null,
        usage_side:c?.usage_side ?? null,
        vector_similarity:Number(c?.vector_similarity || 0),
        raw_vector_similarity:Number(c?.raw_vector_similarity ?? c?.vector_similarity ?? 0),
        probe_consensus:Number(c?.probe_consensus ?? 0),
        probe_rrf:Number(c?.probe_rrf ?? 0),
        metadata_score:Number(c?.metadata_score || 0),
        structural_score:Number(c?.structural_score || 0),
        final_score:Number(c?.final_score || 0),
        matched:Array.isArray(c?.matched) ? c.matched : [],
        conflicts:Array.isArray(c?.conflicts) ? c.conflicts : []
      }))
    })}
  ];

  if (prep?.canonicalImage) {
    parts.push({text:"QUERY_IMAGE"});
    parts.push(geminiImagePart(prep.canonicalImage));
  }

  for (const c of (candidates || []).slice(0, config.vector.resolverK)) {
    const path = c?.vector_object_key || preferredImagePath(c);
    const dataUrl = await r2ImageDataUrl(env, path).catch(() => null);
    if (!dataUrl) continue;

    parts.push({text:`CANDIDATE_IMAGE:${String(c?.id ?? c?.record_id)}`});
    parts.push(geminiImagePart(dataUrl));
  }

  return callGeminiJson(env, {
    model:config.ai.geminiModel,
    systemInstruction:GEMINI_RESOLVER_SYSTEM,
    parts,
    schema:RANKING_SCHEMA,
    timeoutMs:config.ai.geminiTimeoutMs,
    temperature:1.0
  });
}
