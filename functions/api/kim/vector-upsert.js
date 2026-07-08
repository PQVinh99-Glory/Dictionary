import { readKimConfig } from "../../_lib/kim/v5/runtime/config.js";
import { validateSession } from "../../_lib/kim/v5/connectors/supabase.js";
import { rpcService } from "../../_lib/kim/v5/connectors/supabaseService.js";
import { json, readJson, errorResponse } from "../../_lib/shared/http.js";

function requireEditor(me) {
  const role = String(me?.role_name || "").toLowerCase();
  if (!["admin","editor"].includes(role)) {
    const e = new Error("Tài khoản không có quyền ghi vector.");
    e.status = 403;
    throw e;
  }
}

function assertProfile(profile, config) {
  const expected = {
    model:config.vector.model,
    model_version:config.vector.modelVersion,
    preprocess_version:config.vector.preprocessVersion,
    profile:config.vector.profile,
    dimension:config.vector.dimension
  };

  for (const key of Object.keys(expected)) {
    if (String(profile?.[key]) !== String(expected[key])) {
      const e = new Error(
        `Vector profile mismatch tại ${key}.`
      );
      e.status = 400;
      throw e;
    }
  }
}

function vectorLiteral(vector, dimension) {
  if (!Array.isArray(vector) || vector.length !== dimension) {
    const e = new Error(
      `Embedding phải đúng ${dimension} chiều.`
    );
    e.status = 400;
    throw e;
  }

  for (const value of vector) {
    if (!Number.isFinite(Number(value))) {
      const e = new Error("Embedding chứa giá trị không hợp lệ.");
      e.status = 400;
      throw e;
    }
  }

  return `[${vector.map(v => Number(v).toFixed(8)).join(",")}]`;
}

export async function onRequestPost({request,env}) {
  try {
    const config = readKimConfig(env);
    const body = await readJson(request, {maxBytes:2_500_000});
    const token = String(body?.session_token || "");
    const me = await validateSession(env, token);
    requireEditor(me);

    const rows = Array.isArray(body?.vectors)
      ? body.vectors.slice(0,20)
      : [];

    if (!rows.length) {
      const e = new Error("Không có vector để ghi.");
      e.status = 400;
      throw e;
    }

    const results = [];

    for (const row of rows) {
      assertProfile(row?.embedding_profile, config);

      try {
        const id = await rpcService(
          env,
          "kim_upsert_catalogue_image_vector",
          {
            p_record_id:String(row?.record_id || ""),
            p_asset_type:String(row?.asset_type || "front"),
            p_object_key:String(row?.object_key || "").replace(/^\/+/, ""),
            p_view_variant:String(row?.view_variant || "canonical"),
            p_embedding_model:config.vector.model,
            p_embedding_model_version:config.vector.modelVersion,
            p_preprocess_version:config.vector.preprocessVersion,
            p_embedding_profile:config.vector.profile,
            p_embedding:vectorLiteral(
              row?.embedding,
              config.vector.dimension
            ),
            p_foreground_status:String(
              row?.foreground_status || "browser_dinov2"
            ),
            p_quality_score:
              row?.quality_score == null
                ? null
                : Number(row.quality_score)
          }
        );

        results.push({
          ok:true,
          record_id:String(row?.record_id || ""),
          asset_type:String(row?.asset_type || "front"),
          id
        });
      } catch (error) {
        results.push({
          ok:false,
          record_id:String(row?.record_id || ""),
          asset_type:String(row?.asset_type || "front"),
          error:error?.message || String(error)
        });
      }
    }

    const written = results.filter(x => x.ok).length;
    const failed = results.filter(x => !x.ok).length;
    const firstError = results.find(x => !x.ok)?.error || null;

    if (written === 0 && failed > 0) {
      return json({
        ok:false,
        error:
          firstError ||
          "Không ghi được vector nào vào Supabase.",
        written,
        failed,
        results
      }, 502);
    }

    return json({
      ok:true,
      written,
      failed,
      first_error:firstError,
      results
    });
  } catch (error) {
    return errorResponse(error);
  }
}
