import { buildMorisUserMessage } from "./userMessage.js";

export function toPublicMorisResult(result,{debug=false}={}){
  const out = {
    ok:true,
    user_message:buildMorisUserMessage(result),
    candidates:Array.isArray(result?.candidates) ? result.candidates.slice(0,10) : [],
    decision:result?.decision || null
  };

  if(debug){
    out.debug = {
      mode:result?.mode || null,
      summary:result?.summary || null,
      warnings:result?.warnings || [],
      ai_calls:result?.ai_calls ?? null,
      candidate_pool_hash:result?.candidate_pool_hash || null
    };
  }
  return out;
}
