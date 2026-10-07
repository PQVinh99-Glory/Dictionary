// =============================================================================
// GET /api/auth/session — xác thực lại phiên hiện tại (Bearer access token)
// Trả profile + role. Hạn phiên do client giữ (đặt lúc đăng nhập) — xem login.js.
// =============================================================================
import { json, errorResponse } from "../../_lib/shared/http.js";
import { bearer, requireUser } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const token = bearer(request);
    if (!token) return json({ ok: false, error: "Thiếu access token." }, 401);

    const { me, profile } = await requireUser(env, token);

    if (profile && profile.is_active === false) {
      return json({ ok: false, code: "INACTIVE", error: "Tài khoản đã bị vô hiệu hóa." }, 403);
    }

    return json({
      ok: true,
      user: {
        id: me.user_id,
        email: profile?.email || me.username || "",
        username: me.username || "",
        display_name: me.display_name || profile?.email || "",
        role_name: String(profile?.role_name || me.role_name || "").toLowerCase(),
        must_change_password: !!me.must_change_password
      }
    });
  } catch (e) {
    return errorResponse(e);
  }
}
