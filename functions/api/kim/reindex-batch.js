import {
  searchCatalogue,
  validateSession
} from "../../_lib/kim/v5/connectors/supabase.js";
import {
  json,
  readJson,
  errorResponse
} from "../../_lib/shared/http.js";

function requireAdmin(me) {
  if (String(me?.role_name || "").toLowerCase() !== "admin") {
    const e = new Error("Chỉ admin được chạy vector reindex.");
    e.status = 403;
    throw e;
  }
}

function assetRows(row) {
  const seen = new Set();
  const assets = [];

  const add = (assetType, objectKey) => {
    const key = String(objectKey || "").replace(/^\/+/,"");
    if (!key || seen.has(key)) return;
    seen.add(key);

    assets.push({
      record_id:String(row?.id ?? ""),
      code:row?.code ?? null,
      part_id:row?.part_id ?? null,
      asset_type:assetType,
      object_key:key
    });
  };

  add("front", row?.front_path);
  add("back", row?.back_path);
  add("detail", row?.detail_path);
  add("compare", row?.compare_path);

  // Fallback only when there is no real view image.
  if (!assets.length) {
    add("thumb", row?.thumb_path || row?.fallback_path);
  }

  return assets;
}

export async function onRequestPost({request,env}) {
  try {
    const body = await readJson(request, {maxBytes:100_000});
    const token = String(body?.session_token || "");
    const offset = Math.max(0, Number(body?.offset || 0));
    const limit = Math.max(
      1,
      Math.min(Number(body?.limit || 25), 50)
    );

    const me = await validateSession(env, token);
    requireAdmin(me);

    const rows = await searchCatalogue(env, token, {
      search:"",
      usageSide:"all",
      viewMode:"all",
      limit,
      offset
    });

    return json({
      ok:true,
      offset,
      row_count:rows.length,
      items:rows.flatMap(assetRows),
      next_offset:offset + rows.length,
      has_more:rows.length === limit
    });
  } catch (error) {
    return errorResponse(error);
  }
}
