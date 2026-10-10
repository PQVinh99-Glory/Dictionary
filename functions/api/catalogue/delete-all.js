import {
  rpc,
  validateSession
} from "../../_lib/moris/v5/connectors/supabase.js";

import {
  json,
  readJson,
  errorResponse
} from "../../_lib/shared/http.js";

function requireAdmin(me) {
  if (String(me?.role_name || "").toLowerCase() !== "admin") {
    const e = new Error("Chỉ admin mới có quyền xóa toàn bộ catalogue.");
    e.status = 403;
    throw e;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request, { maxBytes: 10_000 });
    const authHeader = request.headers.get("authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const token = String(body?.session_token || request.headers.get("x-session-token") || bearer || "").trim();

    const me = await validateSession(env, token);
    requireAdmin(me);

    if (body?.confirm !== true) {
      const e = new Error("Yêu cầu xác nhận xóa toàn bộ catalogue (confirm=true).");
      e.status = 400;
      throw e;
    }

    const out = await rpc(env, "app_delete_all_parts", {
      p_session_token: token
    });

    // Dọn dẹp sạch sẽ toàn bộ bucket R2
    let r2CleanedCount = 0;
    if (env.CATALOGUE_BUCKET) {
      try {
        let truncated = true;
        let cursor;
        while (truncated) {
          const list = await env.CATALOGUE_BUCKET.list({ cursor, limit: 500 });
          if (list.objects?.length) {
            const keys = list.objects.map(o => o.key);
            await env.CATALOGUE_BUCKET.delete(keys);
            r2CleanedCount += keys.length;
          }
          truncated = list.truncated;
          cursor = list.cursor;
        }
      } catch (r2Err) {
        console.warn("R2 purge all error:", r2Err);
      }
    }

    return json({
      ok: true,
      deleted_count: out?.deleted_count || 0,
      r2_cleaned_count: r2CleanedCount,
      message: `Đã xóa sạch toàn bộ ${out?.deleted_count || 0} mã trong catalogue và dọn dẹp ${r2CleanedCount} file ảnh R2.`
    });
  } catch (error) {
    return errorResponse(error);
  }
}
