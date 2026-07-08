import { callOpenRouterJson } from "../providers/openrouter.js";
import { judgePrompt } from "../memory/prompts.js";
import { JUDGE_SCHEMA } from "../schemas/judge.js";

export async function criticJudge(env, {
  model,
  timeoutMs,
  message,
  signature,
  ranking,
  candidates,
  candidatePoolHash
}) {
  return await callOpenRouterJson(env, {
    model,
    timeoutMs,
    schema:JUDGE_SCHEMA,
    schemaName:"denis_critic_judge",
    messages:[
      {role:"system",content:judgePrompt(message,signature)},
      {
        role:"user",
        content:JSON.stringify({
          candidate_pool_hash:candidatePoolHash,
          resolver_output:ranking,
          candidates:candidates.map(r => ({
            candidate_id:String(r.id),
            code:r.code,
            part_id:r.part_id,
            usage_side:r.usage_side,
            is_symmetric:!!r.is_symmetric,
            identifying_features:r.identifying_features,
            confusing_note:r.confusing_note
          }))
        })
      }
    ]
  });
}
