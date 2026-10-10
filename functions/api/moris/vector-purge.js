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
    const e = new Error("Chỉ admin mới có quyền xóa toàn bộ vector.");
    e.status = 403;
    throw e;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request, { maxBytes: 10_000 });
    const authHeader = request.headers.get("authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const token = String(body?.session_token || bearer || "").trim();

    const me = await validateSession(env, token);
    requireAdmin(me);

    const out = await rpc(env, "kim_purge_all_catalogue_image_vectors", {
      p_session_token: token
    });

    return json({
      ok: true,
      message: out?.message || "Đã xóa toàn bộ vector thành công."
    });
  } catch (error) {
    return errorResponse(error);
  }
}
