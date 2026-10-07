// =============================================================================
// POST /api/auth/login — đăng nhập + chống dò mật khẩu (khóa tài khoản)
//
// Quy ước (theo yêu cầu vận hành):
//   1..4 lần sai  -> 401 + "Còn X lần thử"
//   lần thứ 5     -> 423, khóa 1 giờ; hết hạn khóa -> bộ đếm về 0
//   lần thứ 7     -> 423, khóa vĩnh viễn -> admin phải cấp lại mật khẩu
//   thành công    -> reset toàn bộ bộ đếm
//
// Trả về session Supabase (access/refresh) + hạn phiên = 00:00 UTC kế tiếp
// (= 07:00 giờ Việt Nam) để client tự đăng xuất đúng chu kỳ 24h.
// =============================================================================
import { json, readJson, errorResponse } from "../../_lib/shared/http.js";
import {
  configMissing, sessionExpiry, passwordGrant, resolveLoginProfile,
  getSecurity, putSecurity, FAIL_WARN_AT, FAIL_PERMANENT_AT
} from "../../_lib/auth.js";

const LOCK_MS = 3600_000;

export async function onRequestPost({ request, env }) {
  try {
    const missing = configMissing(env);
    if (missing) return json({ ok: false, error: missing }, 503);

    const body = await readJson(request, { maxBytes: 8_000 });
    // Nhận cả email lẫn TÊN ĐĂNG NHẬP (user do admin tạo không có email thật).
    const loginInput = String(body.email || body.username || "").trim();
    const password = String(body.password || "");

    if (!loginInput || !password) {
      return json({ ok: false, error: "Thiếu email/tên đăng nhập hoặc mật khẩu." }, 400);
    }

    const profile = await resolveLoginProfile(env, loginInput);
    let sec = profile ? await getSecurity(env, profile.id) : null;
    const now = Date.now();

    // ---- Chặn trước khi thử mật khẩu (không lộ mật khẩu cho người dò) ----
    if (sec?.permanent_lock) {
      return json({
        ok: false,
        code: "LOCKED_PERMANENT",
        error: "Tài khoản bị khóa vĩnh viễn do nhập sai mật khẩu nhiều lần. Liên hệ admin để cấp lại mật khẩu."
      }, 423);
    }

    if (sec?.locked_until && new Date(sec.locked_until).getTime() > now) {
      // Vẫn khóa: mỗi lần thử nữa đều ĐƯỢC ĐẾM (không gọi GoTrue) để chạm
      // ngưỡng 7 lần -> khóa vĩnh viễn. Hạn khóa giữ nguyên theo đúng "1 giờ".
      const count = Number(sec.failed_count || 0) + 1;
      if (count >= FAIL_PERMANENT_AT) {
        await putSecurity(env, profile.id, {
          failed_count: count,
          permanent_lock: true,
          locked_until: null
        });
        return json({
          ok: false,
          code: "LOCKED_PERMANENT",
          error: "Tài khoản bị khóa vĩnh viễn do nhập sai mật khẩu quá nhiều lần. Liên hệ admin để cấp lại mật khẩu."
        }, 423);
      }
      await putSecurity(env, profile.id, { failed_count: count });

      const mins = Math.max(1, Math.ceil((new Date(sec.locked_until).getTime() - now) / 60000));
      return json({
        ok: false,
        code: "LOCKED_TEMP",
        locked_until: sec.locked_until,
        failed_count: count,
        error: `Tài khoản đang bị khóa do nhập sai mật khẩu quá ${FAIL_WARN_AT} lần. Thử lại sau ${mins} phút, hoặc liên hệ admin để mở khóa.`
      }, 423);
    }

    if (sec?.locked_until) {
      // Hết hạn khóa 1 giờ -> reset bộ đếm (trừ khi đã đạt ngưỡng vĩnh viễn)
      if (Number(sec.failed_count) >= FAIL_PERMANENT_AT) {
        sec = await putSecurity(env, profile.id, { permanent_lock: true, locked_until: null });
        return json({
          ok: false,
          code: "LOCKED_PERMANENT",
          error: "Tài khoản bị khóa vĩnh viễn do nhập sai mật khẩu nhiều lần. Liên hệ admin để cấp lại mật khẩu."
        }, 423);
      }
      sec = await putSecurity(env, profile.id, { failed_count: 0, locked_until: null });
    }

    // ---- Xác thực mật khẩu qua Supabase Auth ----
    // Gõ tên đăng nhập -> dùng email thật của profile; không thấy profile
    // thì vẫn gọi với input gốc để trả INVALID_CREDENTIALS chung (không lộ
    // user nào tồn tại).
    const grant = await passwordGrant(env, profile?.email || loginInput, password);

    if (!grant.ok) {
      if (!profile) {
        // Không có profile: vẫn trả lỗi chung (không phân biệt "tồn tại hay không")
        return json({ ok: false, code: "INVALID_CREDENTIALS", error: "Tên đăng nhập hoặc mật khẩu không đúng." }, 401);
      }

      const count = Number(sec?.failed_count || 0) + 1;
      const patch = { failed_count: count, last_failure_at: new Date().toISOString() };

      if (count >= FAIL_PERMANENT_AT) {
        patch.permanent_lock = true;
        patch.locked_until = null;
        await putSecurity(env, profile.id, patch);
        return json({
          ok: false,
          code: "LOCKED_PERMANENT",
          error: "Tài khoản bị khóa vĩnh viễn do nhập sai mật khẩu quá nhiều lần. Liên hệ admin để cấp lại mật khẩu."
        }, 423);
      }

      if (count >= FAIL_WARN_AT) {
        patch.locked_until = new Date(now + LOCK_MS).toISOString();
        await putSecurity(env, profile.id, patch);
        return json({
          ok: false,
          code: "LOCKED_TEMP",
          locked_until: patch.locked_until,
          error: `Bạn đã nhập sai mật khẩu quá ${FAIL_WARN_AT} lần. Tài khoản bị khóa 1 giờ. Liên hệ admin nếu cần mở khóa ngay.`
        }, 423);
      }

      await putSecurity(env, profile.id, patch);
      const remaining = FAIL_WARN_AT - count;
      return json({
        ok: false,
        code: "INVALID_CREDENTIALS",
        failed_count: count,
        remaining,
        error: `Tên đăng nhập hoặc mật khẩu không đúng. Còn ${remaining} lần thử.`
      }, 401);
    }

    // ---- Thành công ----
    if (!profile) {
      return json({
        ok: false,
        code: "NO_PROFILE",
        error: "Tài khoản chưa được cấp quyền trong Catalogue. Liên hệ admin để được thêm."
      }, 403);
    }
    if (!profile.is_active) {
      return json({
        ok: false,
        code: "INACTIVE",
        error: "Tài khoản đã bị vô hiệu hóa. Liên hệ admin để kích hoạt lại."
      }, 403);
    }

    await putSecurity(env, profile.id, {
      failed_count: 0,
      locked_until: null,
      permanent_lock: false,
      must_reset: false,
      last_login_at: new Date().toISOString()
    });

    const s = grant.session || {};
    return json({
      ok: true,
      user: {
        id: profile.id,
        email: profile.email,
        role_name: profile.role_name,
        display_name: String(profile.email || "").split("@")[0]
      },
      session: {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        token_type: s.token_type || "bearer",
        expires_in: s.expires_in ?? 3600
      },
      expires_at: sessionExpiry()
    });
  } catch (e) {
    return errorResponse(e);
  }
}
