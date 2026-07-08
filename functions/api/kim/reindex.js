import { readKimConfig } from "../../_lib/kim/v5/runtime/config.js";
import { scanCatalogue, rpc } from "../../_lib/kim/v5/connectors/supabase.js";
import { preferredImagePath, r2ImageDataUrl } from "../../_lib/kim/v5/connectors/r2.js";
import { encodeQueryImage } from "../../_lib/kim/v5/vector/encoder.js";
import { activeVectorProfile } from "../../_lib/kim/v5/vector/profiles.js";
import { json, readJson, errorResponse } from "../../_lib/shared/http.js";

function assertAdmin(request, env) {
  const expected = String(env.KIM_ADMIN_TOKEN || "");
  const actual = String(request.headers.get("x-kim-admin-token") || "");

  if (!expected || actual !== expected) {
    const e = new Error("Unauthorized Kim admin route.");
    e.status = 401;
    throw e;
  }
}

export async function onRequestPost({request,env}) {
  try {
    assertAdmin(request,env);

    const config = readKimConfig(env);
    const body = await readJson(request, {maxBytes:100_000});
    const limit = Math.max(1, Math.min(Number(body?.limit || 10), 25));
    const offset = Math.max(0, Number(body?.offset || 0));

    if (!config.endpoints.embedding) {
      return json({
        ok:false,
        error:"KIM_EMBEDDING_ENDPOINT bắt buộc cho server-side reindex."
      },503);
    }

    const all = await scanCatalogue(env, String(body?.session_token || ""), {
      maxRows:Math.min(config.limits.maxScanRows, offset + limit + 1)
    });

    const batch = all.slice(offset, offset + limit);
    const profile = activeVectorProfile(config);

    const results = [];

    for (const row of batch) {
      const path = preferredImagePath(row);
      if (!path) {
        results.push({id:row?.id,ok:false,error:"missing_image_path"});
        continue;
      }

      const image = await r2ImageDataUrl(env,path);
      if (!image) {
        results.push({id:row?.id,ok:false,error:"image_unavailable"});
        continue;
      }

      try {
        const encoded = await encodeQueryImage(env, config, {
          canonicalImage:image,
          suppliedEmbedding:null,
          suppliedProfile:null
        });

        await rpc(env, "kim_upsert_catalogue_image_vector", {
          p_record_id:String(row?.id),
          p_asset_type:row?.front_path ? "front" : "thumb",
          p_object_key:path,
          p_view_variant:"canonical",
          p_embedding_model:profile.model,
          p_embedding_model_version:profile.model_version,
          p_preprocess_version:profile.preprocess_version,
          p_embedding_profile:profile.profile,
          p_embedding:`[${encoded.vector.join(",")}]`,
          p_foreground_status:"reindex_bridge",
          p_quality_score:null
        });

        results.push({id:row?.id,ok:true});
      } catch (error) {
        results.push({id:row?.id,ok:false,error:error?.message || String(error)});
      }
    }

    return json({
      ok:true,
      offset,
      processed:results.length,
      next_offset:offset + results.length,
      results
    });
  } catch (error) {
    return errorResponse(error);
  }
}
