import { readKimConfig } from "../../_lib/kim/v5/runtime/config.js";
import { createQueryContext } from "../../_lib/kim/v5/runtime/queryContext.js";
import { validateKimQuery } from "../../_lib/kim/v5/schemas/query.js";
import { validateSession } from "../../_lib/kim/v5/connectors/supabase.js";
import { runKimSearch } from "../../_lib/kim/v5/orchestrator.js";
import { classifyCatalogueIntent } from "../../_lib/kim/v5/intent/catalogueIntent.js";
import { toPublicKimResult } from "../../_lib/kim/v5/presentation/publicResult.js";
import { KIM_PUBLIC_MESSAGES } from "../../_lib/kim/v5/presentation/userMessage.js";
import { json, readJson } from "../../_lib/shared/http.js";

function debugEnabled(env){
  return /^(1|true|yes|on)$/i.test(String(env.KIM_DEBUG_EXPOSE_INTERNAL || ""));
}

export async function onRequestPost({request,env}){
  let queryId = crypto.randomUUID();

  try{
    const config = readKimConfig(env);
    if(!config.enabled){
      return json({ok:false,user_message:KIM_PUBLIC_MESSAGES.temporaryError},503);
    }

    const body = await readJson(request);
    const token = String(
      body?.session_token ||
      request.headers.get("x-session-token") ||
      ""
    );

    await validateSession(env,token);

    const query = validateKimQuery(body,config);
    queryId = query.query_id;

    const intent = classifyCatalogueIntent(query);
    if(intent.kind === "unsupported" || intent.kind === "unknown"){
      return json({
        ok:true,
        query_id:queryId,
        user_message:KIM_PUBLIC_MESSAGES.unsupported,
        candidates:[],
        decision:"unsupported"
      });
    }

    const ctx = await createQueryContext({
      queryId:query.query_id,
      message:query.message,
      imageDataUrl:query.image_data_url,
      filters:query.filters,
      config
    });

    const result = await runKimSearch(env,config,{token,query,ctx});
    const publicResult = toPublicKimResult(result,{
      debug:debugEnabled(env)
    });

    return json({
      ...publicResult,
      query_id:ctx.query_id,
      image_hash:ctx.image_hash || null
    });
  }catch(error){
    console.error("Kim search failed",{
      query_id:queryId,
      name:error?.name || "Error",
      message:error?.message || String(error),
      status:error?.status || 500,
      details:error?.details || null,
      stack:error?.stack || null
    });

    return json({
      ok:false,
      query_id:queryId,
      user_message:KIM_PUBLIC_MESSAGES.temporaryError,
      candidates:[]
    }, Number(error?.status)===401 ? 401 : 200);
  }
}
