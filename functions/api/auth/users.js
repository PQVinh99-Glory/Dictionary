// =============================================================================
// /api/auth/users — quản lý người dùng (CHỈ admin)
//
//   GET  /api/auth/users                 -> danh sách user + trạng thái khóa
//   POST /api/auth/users                 -> { user_id, action, role? | username/password }
//     action = create | set_role | unlock | set_active | set_inactive | reset_password
//
// Quyền admin được xác thực qua RPC app_me (JWT) + profiles.role_name.
// create: admin tạo thẳng tài khoản bằng TÊN ĐĂNG NHẬP (không cần email) —
//         hệ thống sinh email ảo định danh trong Supabase Auth.
// Lưu ý: tài khoản admin hệ thống (SYSTEM_ADMIN_EMAIL) bị chặn
//         đổi role / bật-tắt / cấp lại mật khẩu (đổi MK ở menu header).
// =============================================================================
import { json, readJson, errorResponse } from "../../_lib/shared/http.js";
import { rpc } from "../../_lib/moris/v5/connectors/supabase.js";
import {
  bearer, requireAdmin, rest, adminSetPassword, tempPassword, configMissing,
  serviceKey, baseUrl
} from "../../_lib/auth.js";

const ROLES = new Set(["viewer", "converter", "admin"]);

// Email admin hệ thống — hardcode theo yêu cầu vận hành (FE cũng có hằng số này).
const SYSTEM_ADMIN_EMAIL = "pquangvinh1999@gmail.com";
// Domain cho email ảo chỉ dùng để định danh trong Supabase Auth (không gửi mail).
const SYNTHETIC_EMAIL_DOMAIN = "users.catalogue.vn";
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;

function isSystemAdmin(email) {
  return String(email || "").trim().toLowerCase() === SYSTEM_ADMIN_EMAIL;
}

function systemAdminBlocked() {
  const e = new Error(
    "Tài khoản admin hệ thống — không đổi role, không bật/tắt, không cấp lại mật khẩu ở đây. Đổi mật khẩu qua menu trên header."
  );
  e.status = 403;
  return e;
}

async function findProfile(env, userId) {
  const rows = await rest(env, `profiles?select=id,email,username&id=eq.${encodeURIComponent(userId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

/** GoTrue Admin: tạo user mới (email_confirm = true => không gửi mail). */
async function createAuthUser(env, { email, password, username }) {
  const key = serviceKey(env);
  const res = await fetch(`${baseUrl(env)}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username } })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(data?.msg || data?.message || `Tạo tài khoản thất bại (HTTP ${res.status}).`);
    e.status = 422;
    e.duplicate = /already (registered|exists)/i.test(String(data?.msg || data?.message || ""));
    throw e;
  }
  return data;
}

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
    const action = String(body.action || "").trim();
    if (!action) return json({ ok: false, error: "Thiếu action." }, 400);

    // ---- Thêm user mới (không cần user_id) ----
    if (action === "create") {
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const role = String(body.role || "viewer").trim().toLowerCase();

      if (!ROLES.has(role)) return json({ ok: false, error: "Role không hợp lệ (viewer | converter | admin)." }, 400);
      if (!USERNAME_RE.test(username)) {
        return json({ ok: false, error: "Tên đăng nhập 3–32 ký tự: chữ, số, dấu . _ - (không chứa @)." }, 400);
      }
      if (password.length < 6) return json({ ok: false, error: "Mật khẩu tối thiểu 6 ký tự." }, 400);

      // Trùng tên đăng nhập (so cả email ảo lẫn username, không phân biệt hoa/thường)
      const rows = await rest(env, "profiles?select=username,email&limit=1000");
      const key = username.toLowerCase();
      const taken = Array.isArray(rows) && rows.some((r) =>
        String(r.username || "").trim().toLowerCase() === key ||
        String(r.email || "").split("@")[0].trim().toLowerCase() === key
      );
      if (taken) return json({ ok: false, error: `Tên đăng nhập "${username}" đã tồn tại.` }, 409);

      const email = `${key}@${SYNTHETIC_EMAIL_DOMAIN}`;
      const created = await createAuthUser(env, { email, password, username });
      const userId = created?.id || created?.user?.id;
      if (!userId) return json({ ok: false, error: "Supabase không trả về id user mới." }, 502);

      // Trigger on_auth_user_created đã tạo profiles (role mặc định 'viewer')
      // => giờ cập nhật username + role admin chọn.
      await rest(env, `profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: { username, role_name: role }
      });

      return json({ ok: true, user_id: userId, username, email, role_name: role });
    }

    const userId = String(body.user_id || "").trim();
    if (!userId) return json({ ok: false, error: "Thiếu user_id." }, 400);

    // ---- Chặn thao tác trên tài khoản admin hệ thống ----
    if (["set_role", "set_active", "set_inactive", "reset_password"].includes(action)) {
      const target = await findProfile(env, userId);
      if (isSystemAdmin(target?.email)) throw systemAdminBlocked();
    }

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
