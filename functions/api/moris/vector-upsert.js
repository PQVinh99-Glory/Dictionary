import { readMorisConfig } from "../../_lib/moris/v5/runtime/config.js";
import { validateSession } from "../../_lib/moris/v5/connectors/supabase.js";
import { rpcService, baseUrl, serverKey, headersForKey } from "../../_lib/moris/v5/connectors/supabaseService.js";
import {
  json,
  readJson,
  errorResponse
} from "../../_lib/shared/http.js";

const MAX_VECTORS_PER_REQUEST = 20;

function requireEditor(me) {
  const role = String(me?.role_name || "").toLowerCase();

  if (!["admin", "converter", "editor"].includes(role)) {
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
      const e = new Error(`Vector profile mismatch tại ${key}.`);
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
      const e = new Error(
        "Embedding chứa giá trị không hợp lệ."
      );
      e.status = 400;
      throw e;
    }
  }

  return `[${vector
    .map(v => Number(v).toFixed(8))
    .join(",")}]`;
}

export async function onRequestPost({request,env}) {
  try {
    const config = readMorisConfig(env);

    const body = await readJson(request,{
      maxBytes:2_500_000
    });

    const token = String(body?.session_token || "");
    const me = await validateSession(env, token);
    requireEditor(me);

    const incoming = Array.isArray(body?.vectors)
      ? body.vectors
      : [];

    if (!incoming.length) {
      const e = new Error("Không có vector để ghi.");
      e.status = 400;
      throw e;
    }

    // V5.8 invariant:
    // Không được silently truncate dữ liệu vector.
    if (incoming.length > MAX_VECTORS_PER_REQUEST) {
      return json({
        ok:false,
        error:
          `Mỗi request tối đa ${MAX_VECTORS_PER_REQUEST} vector. ` +
          `Client phải gửi theo chunk.`,
        accepted:0,
        written:0,
        failed:incoming.length
      },413);
    }

    const rows = incoming;
    const results = [];

    for (const row of rows) {
      assertProfile(row?.embedding_profile, config);

      if (body?.prevent_duplicate) {
        try {
          const key = serverKey(env);
          const base = baseUrl(env);
          const checkUrl = `${base}/rest/v1/catalogue_image_vectors?record_id=eq.${encodeURIComponent(row?.record_id)}&asset_type=eq.${encodeURIComponent(row?.asset_type || "front")}&is_active=eq.true&limit=1`;
          const checkRes = await fetch(checkUrl, { headers: headersForKey(key) });
          if (checkRes.ok) {
            const existingRows = await checkRes.json();
            if (Array.isArray(existingRows) && existingRows.length > 0) {
              results.push({
                ok: false,
                already_exists: true,
                record_id: String(row?.record_id || ""),
                asset_type: String(row?.asset_type || "front"),
                error: `Ảnh ${row?.asset_type || "mặt"} của mã này đã có vector trước đó. Bỏ qua để tránh trùng lặp.`
              });
              continue;
            }
          }
        } catch (_) {}
      }

      try {
        const id = await rpcService(
          env,
          "kim_upsert_catalogue_image_vector",
          {
            p_record_id:String(row?.record_id || ""),
            p_asset_type:String(row?.asset_type || "front"),
            p_object_key:String(row?.object_key || "")
              .replace(/^\/+/, ""),
            p_view_variant:String(
              row?.view_variant || "canonical"
            ),

            p_embedding_model:config.vector.model,
            p_embedding_model_version:
              config.vector.modelVersion,
            p_preprocess_version:
              config.vector.preprocessVersion,
            p_embedding_profile:
              config.vector.profile,

            p_embedding:vectorLiteral(
              row?.embedding,
              config.vector.dimension
            ),

            p_foreground_status:String(
              row?.foreground_status ||
              "browser_dinov2_v58"
            ),

            p_quality_score:
              row?.quality_score == null
                ? null
                : Number(row.quality_score),

            p_hole_count:
              row?.hole_count == null
                ? 0
                : Math.max(0, parseInt(row.hole_count, 10) || 0),

            p_aspect_ratio:
              row?.aspect_ratio == null
                ? 1.0
                : Number(row.aspect_ratio) || 1.0,

            p_hole_centroids:
              Array.isArray(row?.hole_centroids)
                ? row.hole_centroids
                : []
          }
        );

        results.push({
          ok:true,
          record_id:String(row?.record_id || ""),
          asset_type:String(
            row?.asset_type || "front"
          ),
          id
        });
      } catch (error) {
        results.push({
          ok:false,
          record_id:String(row?.record_id || ""),
          asset_type:String(
            row?.asset_type || "front"
          ),
          error:error?.message || String(error)
        });
      }
    }

    const written = results.filter(x => x.ok).length;
    const failed = results.filter(x => !x.ok).length;
    const firstError =
      results.find(x => !x.ok)?.error || null;

    if (written === 0 && failed > 0) {
      const allAlreadyExists = results.every(x => x.already_exists);
      return json({
        ok:false,
        already_exists: allAlreadyExists,
        error:
          firstError ||
          "Không ghi được vector nào vào Supabase.",
        accepted:rows.length,
        written,
        failed,
        results
      }, allAlreadyExists ? 409 : 502);
    }

    return json({
      ok:true,
      accepted:rows.length,
      written,
      failed,
      first_error:firstError,
      results
    });
  } catch (error) {
    return errorResponse(error);
  }
}
