import { readKimConfig } from "../../_lib/kim/v5/runtime/config.js";
import { validateSession } from "../../_lib/kim/v5/connectors/supabase.js";
import { json } from "../../_lib/shared/http.js";

export async function onRequestGet({request,env}){
  const url=new URL(request.url);
  const token=String(
    url.searchParams.get("session_token") ||
    request.headers.get("x-session-token") || ""
  );
  const me=await validateSession(env,token);
  if(String(me?.role_name || "").toLowerCase() !== "admin"){
    return json({ok:false,error:"Admin only."},403);
  }
  const config=readKimConfig(env);
  return json({
    ok:true,
    service:"thu-ky-kim-v5.9",
    features:config.features,
    vector:config.vector,
    gates:config.gates,
    providers:{
      gemini:{configured:!!env.GEMINI_API_KEY,enabled:config.features.geminiRerank},
      openrouter:{configured:!!env.OPENROUTER_API_KEY,enabled:config.features.gemmaJudge}
    },
    vector_write:{
      server_secret_configured:!!(
        env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
      )
    }
  });
}
