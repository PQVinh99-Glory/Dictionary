import {
  rpc,
  searchCatalogue,
  validateSession
} from "../../_lib/moris/v5/connectors/supabase.js";

import {
  json,
  errorResponse
} from "../../_lib/shared/http.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get("authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const token = String(url.searchParams.get("session_token") || bearer || "").trim();
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 50), 100));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    const search = String(url.searchParams.get("search") || "").trim();

    await validateSession(env, token);

    // 1. Lấy danh sách linh kiện
    const rows = await searchCatalogue(env, token, {
      search,
      usageSide: "all",
      viewMode: "all",
      limit,
      offset
    });

    // 2. Lấy danh sách các vector đã tồn tại trong DB
    let existingVectorKeys = new Set();
    try {
      const vecList = await rpc(env, "kim_list_vector_record_ids", { p_session_token: token });
      const items = Array.isArray(vecList?.items) ? vecList.items : [];
      for (const v of items) {
        if (v.record_id) existingVectorKeys.add(String(v.record_id));
        if (v.object_key) existingVectorKeys.add(String(v.object_key).replace(/^\/+/, ""));
      }
    } catch (err) {
      console.warn("vector-items: rpc kim_list_vector_record_ids failed:", err?.message || err);
    }

    if (existingVectorKeys.size === 0) {
      try {
        const { baseUrl, serverKey, headersForKey } = await import("../../_lib/moris/v5/connectors/supabaseService.js");
        const key = serverKey(env);
        const base = baseUrl(env);
        if (key && base) {
          const res = await fetch(`${base}/rest/v1/catalogue_image_vectors?select=record_id,object_key&is_active=eq.true&limit=1000`, {
            headers: headersForKey(key)
          });
          if (res.ok) {
            const rawVecs = await res.json();
            if (Array.isArray(rawVecs)) {
              for (const v of rawVecs) {
                if (v.record_id) existingVectorKeys.add(String(v.record_id));
                if (v.object_key) existingVectorKeys.add(String(v.object_key).replace(/^\/+/, ""));
              }
            }
          }
        }
      } catch (_) {}
    }

    // 3. Tải chi tiết assets cho từng linh kiện
    const items = [];
    for (const row of rows) {
      let assets = [];
      try {
        const rawAssets = await rpc(env, "app_get_part_assets", {
          p_session_token: token,
          p_image_id: row.id
        });
        assets = Array.isArray(rawAssets) ? rawAssets : [];
      } catch (_) {}

      const hasVector = existingVectorKeys.has(String(row.id)) ||
        assets.some(a => a.image_path && existingVectorKeys.has(String(a.image_path).replace(/^\/+/, "")));

      items.push({
        id: String(row.id),
        code: row.code || "UNKNOWN",
        part_id: row.part_id || "",
        usage_side: row.usage_side || "unknown",
        view_mode: row.view_mode || "single_face",
        thumb_path: row.thumb_path || row.front_path || row.fallback_path || (assets[0]?.image_path || ""),
        assets: assets.map(a => ({
          asset_type: a.asset_type,
          image_path: a.image_path,
          has_vector: existingVectorKeys.has(String(a.image_path).replace(/^\/+/, ""))
        })),
        has_vector: hasVector
      });
    }

    return json({
      ok: true,
      items,
      count: items.length,
      offset,
      has_more: rows.length === limit
    });
  } catch (error) {
    return errorResponse(error);
  }
}
