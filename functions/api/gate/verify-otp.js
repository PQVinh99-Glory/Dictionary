// =============================================================================
// POST /api/gate/verify-otp — Xác thực Microsoft Authenticator (TOTP 6 hoặc 8 số)
// Hỗ trợ cả 2FA theo từng User (Per-User 2FA) lẫn Khóa Admin dự phòng
// Cấp cookie catalogue_session làm mới lúc 07:00 sáng hàng ngày (tối đa 24 giờ)
// =============================================================================
import {
  verifyTotp,
  createGateSession,
  checkBotProtection,
  checkRateLimit,
  recordFailedGateAttempt,
  resetFailedGateAttempt,
  getClientIp,
  getTotpSecret
} from "../../_lib/gatekeeper.js";
import { isSystemAdminEmail } from "../../_lib/auth.js";

async function findUserProfile(env, loginInput) {
  const base = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  const input = String(loginInput || "").trim();
  if (!input) return null;

  try {
    const res = await fetch(
      `${base}/rest/v1/profiles?or=(username.ilike.${encodeURIComponent(input)},email.ilike.${encodeURIComponent(input)})&limit=1`,
      { headers: { apikey: key, authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (_) {
    return null;
  }
}

async function getUserSecurity(env, userId) {
  const base = env?.SUPABASE_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;

  try {
    const res = await fetch(
      `${base}/rest/v1/user_security?user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      { headers: { apikey: key, authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (_) {
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  try {
    // 1. LỚP 1: Kiểm tra chống Bot & Script tự động
    const botCheck = checkBotProtection(request);
    if (!botCheck.ok) {
      return new Response(JSON.stringify(botCheck), {
        status: botCheck.status,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    const body = await request.json().catch(() => ({}));
    const username = String(body.username || "").trim();
    const code = String(body.code || body.token || "").trim();

    if (!code) {
      return new Response(JSON.stringify({ ok: false, error: "Vui lòng nhập mã từ Authenticator." }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // 2. LỚP 2: Kiểm tra Rate Limit & Trạng thái khóa IP
    const rateCheck = checkRateLimit(request);
    if (!rateCheck.ok) {
      return new Response(JSON.stringify(rateCheck), {
        status: rateCheck.status,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    const clientIp = getClientIp(request);
    let isValid = false;
    let targetUserId = null;
    let targetUsername = null;

    const UNIFORM_ERROR = "Tên đăng nhập hoặc mã xác thực không chính xác.";

    if (username) {
      // Xác thực theo từng User riêng biệt (Per-User 2FA)
      const profile = await findUserProfile(env, username);
      if (!profile || profile.is_active === false) {
        recordFailedGateAttempt(clientIp);
        return new Response(JSON.stringify({ ok: false, error: UNIFORM_ERROR }), {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }

      const sec = await getUserSecurity(env, profile.id);
      if (sec && sec.totp_enabled === false) {
        recordFailedGateAttempt(clientIp);
        return new Response(JSON.stringify({ ok: false, error: UNIFORM_ERROR }), {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }

      const isSysAdmin = isSystemAdminEmail(profile.email);
      const secret = sec?.totp_secret || (isSysAdmin ? getTotpSecret(env) : null);
      if (!secret) {
        recordFailedGateAttempt(clientIp);
        return new Response(JSON.stringify({ ok: false, error: UNIFORM_ERROR }), {
          status: 401,
          headers: { "content-type": "application/json; charset=utf-8" }
        });
      }

      isValid = await verifyTotp(env, code, 1, secret);
      targetUserId = profile.id;
      targetUsername = profile.username || profile.email;
    } else {
      // Chế độ không nhập username (Khóa admin mặc định toàn hệ thống)
      isValid = await verifyTotp(env, code);
      targetUserId = "admin";
      targetUsername = "admin";
    }

    if (!isValid) {
      // Nhập sai mã Authenticator -> Ghi nhận lỗi và khóa vĩnh viễn nếu >= 5 lần
      recordFailedGateAttempt(clientIp);
      return new Response(JSON.stringify({
        ok: false,
        error: UNIFORM_ERROR
      }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // Xác thực thành công: Reset lỗi của IP
    resetFailedGateAttempt(clientIp);

    // Tạo phiên đăng nhập có chữ ký số HMAC-SHA256, hết hạn lúc 07:00 sáng giờ VN kế tiếp
    const session = await createGateSession(env, targetUserId);
    const isHttps = new URL(request.url).protocol === "https:";
    const cookie = `catalogue_session=${encodeURIComponent(session.token)}; Path=/; SameSite=Lax; HttpOnly; Max-Age=${session.maxAgeSeconds}${isHttps ? "; Secure" : ""}`;

    return new Response(JSON.stringify({
      ok: true,
      message: "Xác thực thành công. Đang mở cổng...",
      user: targetUsername,
      expires_at: session.expiresAt
    }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": cookie
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || "Lỗi máy chủ." }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}
