// =============================================================================
// POST /api/auth/logout — thu hồi phiên Supabase (refresh token) phía server.
// =============================================================================
import { json, readJson, errorResponse } from "../../_lib/shared/http.js";
import { adminLogout, configMissing } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  try {
    const missing = configMissing(env);
    if (missing) return json({ ok: false, error: missing }, 503);

    const body = await readJson(request, { maxBytes: 4_000 });
    const token = String(body.access_token || body.token || "").trim();
    if (token) await adminLogout(env, token);

    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
