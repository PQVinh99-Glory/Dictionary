import { callOpenRouterJson } from "../providers/openrouter.js";
import { GEMMA_JUDGE_SYSTEM } from "../prompts/gemmaJudge.js";
import { JUDGE_SCHEMA } from "../schemas/judge.js";

export async function judgeWithGemma(env, config, {
  query,
  candidates,
  geminiResult,
  budget
}) {
  budget.consume("openrouter");

  return callOpenRouterJson(env, {
    model:config.ai.gemmaModel,
    timeoutMs:config.ai.openRouterTimeoutMs,
    schema:JUDGE_SCHEMA,
    schemaName:"kim_gemma_judge",
    messages:[
      {role:"system",content:GEMMA_JUDGE_SYSTEM},
      {
        role:"user",
        content:JSON.stringify({
          query_text:query.message || "",
          candidates:(candidates || []).map(c => ({
            candidate_id:String(c?.id ?? c?.record_id),
            code:c?.code ?? null,
            part_id:c?.part_id ?? null,
            identifying_features:c?.identifying_features ?? null,
            confusing_note:c?.confusing_note ?? null,
            usage_side:c?.usage_side ?? null,
            vector_similarity:Number(c?.vector_similarity || 0),
            metadata_score:Number(c?.metadata_score || 0),
            structural_score:Number(c?.structural_score || 0),
            final_score:Number(c?.final_score || 0),
            matched:Array.isArray(c?.matched) ? c.matched : [],
            conflicts:Array.isArray(c?.conflicts) ? c.conflicts : []
          })),
          gemini_result:geminiResult
        })
      }
    ]
  });
}
