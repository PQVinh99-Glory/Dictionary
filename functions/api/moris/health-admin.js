import { readMorisConfig } from "../../_lib/moris/v5/runtime/config.js";
import { validateSession } from "../../_lib/moris/v5/connectors/supabase.js";
import { json, errorResponse } from "../../_lib/shared/http.js";

export async function onRequestGet({request,env}){
  try {
    const token = String(
      request.headers.get("x-session-token") ||
      (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
      ""
    ).trim();
    const me=await validateSession(env,token);
    if(String(me?.role_name || "").toLowerCase() !== "admin"){
      return json({ok:false,error:"Admin only."},403);
    }
    const config=readMorisConfig(env);
    return json({
      ok:true,
      service:"moris-v1.0",
      features:config.features,
      vector:config.vector,
      vector_write:{
        server_secret_configured:!!(
          env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
        )
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
