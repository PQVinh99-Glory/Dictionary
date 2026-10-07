// =============================================================================
// /api/auth/users — quản lý người dùng (CHỈ admin)
//
//   GET  /api/auth/users                 -> danh sách user + trạng thái khóa
//   POST /api/auth/users                 -> { user_id, action, role? }
//     action = set_role | unlock | set_active | set_inactive | reset_password
//
// Quyền admin được xác thực qua RPC app_me (JWT) + profiles.role_name.
// Admin KHÔNG tạo user mới (tạo qua Supabase Dashboard -> auth.users).
// =============================================================================
import { json, readJson, errorResponse } from "../../_lib/shared/http.js";
import { rpc } from "../../_lib/moris/v5/connectors/supabase.js";
import {
  bearer, requireAdmin, rest, adminSetPassword, tempPassword, configMissing
} from "../../_lib/auth.js";

const ROLES = new Set(["viewer", "converter", "admin"]);

export async function onRequestGet({ request, env }) {
  try {
    const token = bearer(request);
    await requireAdmin(env, token);

    const rows = await rpc(env, "app_admin_list_profiles", { p_session_token: token });
    return json({ ok: true, users: Array.isArray(rows) ? rows : [] });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const missing = configMissing(env);
    if (missing) return json({ ok: false, error: missing }, 503);

    const token = bearer(request);
    await requireAdmin(env, token);

    const body = await readJson(request, { maxBytes: 4_000 });
    const userId = String(body.user_id || "").trim();
    const action = String(body.action || "").trim();
    if (!userId || !action) return json({ ok: false, error: "Thiếu user_id hoặc action." }, 400);

    switch (action) {
      case "set_role": {
        const role = String(body.role || "").trim().toLowerCase();
        if (!ROLES.has(role)) return json({ ok: false, error: "Role không hợp lệ (viewer | converter | admin)." }, 400);
        const out = await rpc(env, "app_admin_set_profile_role", {
          p_session_token: token,
          p_user_id: userId,
          p_role_name: role
        });
        if (!out?.ok) return json({ ok: false, error: out?.message || "Không đổi được role." }, 400);
        return json({ ok: true, role_name: role });
      }

      case "unlock": {
        const out = await rpc(env, "app_admin_unlock_profile", {
          p_session_token: token,
          p_user_id: userId
        });
        if (!out?.ok) return json({ ok: false, error: out?.message || "Không mở khóa được." }, 400);
        return json({ ok: true, message: out.message || "Đã mở khóa tài khoản." });
      }

      case "set_active":
      case "set_inactive": {
        const active = action === "set_active";
        await rest(env, `profiles?id=eq.${encodeURIComponent(userId)}`, {
          method: "PATCH",
          body: { is_active: active }
        });
        if (active) {
          await rpc(env, "app_admin_unlock_profile", { p_session_token: token, p_user_id: userId });
        }
        return json({ ok: true, is_active: active });
      }

      case "reset_password": {
        const password = tempPassword();
        await adminSetPassword(env, userId, password);
        await rpc(env, "app_admin_unlock_profile", { p_session_token: token, p_user_id: userId });
        await rest(env, `user_security?user_id=eq.${encodeURIComponent(userId)}`, {
          method: "PATCH",
          body: { must_reset: true }
        }).catch(() => null);
        return json({ ok: true, temp_password: password, must_reset: true });
      }

      default:
        return json({ ok: false, error: `Action không hỗ trợ: ${action}` }, 400);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
