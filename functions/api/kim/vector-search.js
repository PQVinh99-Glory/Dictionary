import { readKimConfig } from "../../_lib/kim/v5/runtime/config.js";
import { validateSession } from "../../_lib/kim/v5/connectors/supabase.js";
import { encodeQueryImage } from "../../_lib/kim/v5/vector/encoder.js";
import { searchVectorIndex } from "../../_lib/kim/v5/vector/search.js";
import { json, readJson, errorResponse } from "../../_lib/shared/http.js";

export async function onRequestPost({request,env}) {
  try {
    const config = readKimConfig(env);
    const body = await readJson(request);

    const token = String(body?.session_token || "");
    await validateSession(env, token);

    if (!config.features.vectorSearch) {
      return json({ok:false,error:"KIM_VECTOR_SEARCH_ENABLED=false"},503);
    }

    const encoded = await encodeQueryImage(env, config, {
      canonicalImage:String(body?.image_data_url || ""),
      suppliedEmbedding:body?.query_embedding,
      suppliedProfile:body?.embedding_profile
    });

    const hits = await searchVectorIndex(
      env,
      config,
      encoded.vector,
      body?.match_count || config.vector.topK
    );

    return json({
      ok:true,
      source:encoded.source,
      profile:encoded.profile,
      hits
    });
  } catch (error) {
    return errorResponse(error);
  }
}
