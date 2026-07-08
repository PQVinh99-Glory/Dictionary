import { buildKimUserMessage } from "./userMessage.js";

export function toPublicKimResult(result,{debug=false}={}){
  const out = {
    ok:true,
    user_message:buildKimUserMessage(result),
    candidates:Array.isArray(result?.candidates) ? result.candidates.slice(0,5) : [],
    decision:result?.decision || null
  };

  if(debug){
    out.debug = {
      mode:result?.mode || null,
      summary:result?.summary || null,
      warnings:result?.warnings || [],
      ai_calls:result?.ai_calls || {gemini:0,openrouter:0},
      candidate_pool_hash:result?.candidate_pool_hash || null
    };
  }
  return out;
}
