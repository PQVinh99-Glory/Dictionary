import { normalizeGeometry } from "../../_lib/moris/v5/schemas/geometry.js";
import { readMorisConfig } from "../../_lib/moris/v5/runtime/config.js";
import { validateSession } from "../../_lib/moris/v5/connectors/supabase.js";
import { rpcService } from "../../_lib/moris/v5/connectors/supabaseService.js";
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
    if (typeof value !== "number" || !Number.isFinite(value)) {
      const e = new Error(
        "Embedding chứa giá trị không hợp lệ."
      );
      e.status = 400;
      throw e;
    }
  }

  if (Math.hypot(...vector) < 1e-8) { const e=new Error("Embedding rỗng/zero không hợp lệ."); e.status=400; throw e; }

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

    // An intent marker is not authorization: validateSession/requireEditor run first.
    if (body?.source !== "vector_center" || body?.confirmed !== true) {
      return json({ ok: false, error: "Chỉ tạo vector sau xác nhận trong Trung tâm Vector AI." }, 400);
    }


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

    const mode = body?.mode || (body?.prevent_duplicate ? "skip" : "");
    if (!["skip", "replace"].includes(mode)) return json({ ok:false, error:"Chọn chế độ skip hoặc replace." }, 400);
    const rows = incoming;
    const results = [];

    for (const row of rows) {
      try {
        assertProfile(row?.embedding_profile, config);
        if (!row?.record_id || !row?.object_key || !row?.asset_type) throw new Error("Thiếu định danh ảnh.");
        if (row.view_variant !== "canon_rgb_v2") throw new Error("Chỉ lập chỉ mục canon_rgb_v2; gray chưa được bật.");
        const geometry = normalizeGeometry(row.geometry);
        if (geometry.geometry_version !== "geometry_v1") throw new Error("Thiếu phiên bản geometry.");
        // Keep unmeasured geometry nullable. Experimental contour/patch payloads never enter storage.
        const persistedGeometry=Object.fromEntries(['geometry_version','provenance','quality','coordinate_space','scale','hole_count','big_hole_count','small_hole_count','aspect_ratio','solidity','hole_centroids','count_conflict'].map(k=>[k,geometry[k]??null]));
        const objectKey = String(row.object_key).replace(/^\/+/, "");
        // Compare the ETag of bytes actually embedded with the current R2 object.
        const object = await env.CATALOGUE_BUCKET?.head(objectKey);
        if (!object?.httpEtag || row.source_etag !== object.httpEtag) throw new Error("Ảnh nguồn đã đổi hoặc thiếu ETag; tải lại trước khi tạo vector.");
        const outcome = await rpcService(
            env,
            "kim_write_catalogue_vector_v6_provenance",
            { p_mode: mode, p_vector: {
              source_etag: row.source_etag,
              geometry_evidence:persistedGeometry,
              p_record_id:String(row?.record_id || ""),
              p_asset_type:String(row?.asset_type || "front"),
              p_object_key:objectKey,
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

              p_hole_count: geometry.hole_count,
              p_aspect_ratio: geometry.aspect_ratio,
              p_hole_centroids: geometry.hole_centroids || []
            } }
          );

        if (!outcome?.id || !["created", "replaced", "skipped"].includes(outcome.action)) {
          throw new Error("RPC không trả bằng chứng ghi vector hợp lệ.");
        }

        results.push({
          ok:true,
          record_id:String(row?.record_id || ""),
          asset_type:String(
            row?.asset_type || "front"
          ),
          id: outcome?.id,
          skipped: outcome?.action === "skipped",
          action: outcome?.action
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

    const written = results.filter(x => x.ok && !x.skipped).length;
    const skipped = results.filter(x => x.ok && x.skipped).length;
    const failed = results.filter(x => !x.ok).length;
    const firstError =
      results.find(x => !x.ok)?.error || null;

    if (written === 0 && skipped === 0 && failed > 0) {
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
      ok:failed === 0,
      accepted:rows.length,
      written,
      skipped,
      failed,
      first_error:firstError,
      results
    });
  } catch (error) {
    return errorResponse(error);
  }
}
