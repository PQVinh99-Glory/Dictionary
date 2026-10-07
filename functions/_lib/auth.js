// =============================================================================
// functions/_lib/auth.js — helper cho Pages Function /api/auth/*
//
// Nguồn xác thực: Supabase Auth (GoTrue) — không lưu/đổi mật khẩu trong app.
// Nguồn phân quyền: public.profiles.role_name (viewer | converter | admin).
// Chống dò mật khẩu: public.user_security (ghi bằng service key).
//
// Chu kỳ phiên: 24h bắt đầu 07:00 giờ Việt Nam (= 00:00 UTC) — hạn phiên là
// 00:00 UTC kế tiếp, trả về cho client lưu và tự đăng xuất khi qua hạn.
// =============================================================================
import { validateSession } from "./moris/v5/connectors/supabase.js";

const DAY_MS = 86400_000;          // chu kỳ 1 ngày
const LOCK_MS = 3600_000;          // khóa 1 giờ sau lần sai thứ 5
export const FAIL_WARN_AT = 5;     // 1..4 lần sai -> "còn X lần thử"
export const FAIL_PERMANENT_AT = 7;// lần thứ 7 -> khóa vĩnh viễn

export function baseUrl(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/, "");
}
export function anonKey(env) {
  return String(env.SUPABASE_ANON_KEY || "");
}
export function serviceKey(env) {
  return String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || "");
}
export function configMissing(env) {
  if (!baseUrl(env)) return "Thiếu SUPABASE_URL.";
  if (!anonKey(env)) return "Thiếu SUPABASE_ANON_KEY.";
  if (!serviceKey(env)) return "Thiếu SUPABASE_SERVICE_ROLE_KEY (service key) — cần để khóa tài khoản & quản lý user.";
  return "";
}

/** Hạn phiên kế tiếp = 00:00 UTC (= 07:00 giờ Việt Nam). */
export function sessionExpiry(fromMs = Date.now()) {
  const next = (Math.floor(fromMs / DAY_MS) + 1) * DAY_MS;
  return new Date(next).toISOString();
}

/** PostgREST — luôn kèm service key (bypass RLS). */
export async function rest(env, path, { method = "GET", body, headers = {} } = {}) {
  const key = serviceKey(env);
  if (!key) { const e = new Error("Thiếu service key."); e.status = 503; throw e; }

  const res = await fetch(`${baseUrl(env)}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }

  if (!res.ok) {
    const e = new Error(data?.message || data?.details || `Supabase REST ${method} ${path} HTTP ${res.status}`);
    e.status = res.status >= 400 && res.status < 600 ? res.status : 500;
    throw e;
  }
  return data;
}

/** GoTrue: xác thực mật khẩu (không bao giờ lộ mật khẩu về client). */
export async function passwordGrant(env, email, password) {
  const res = await fetch(`${baseUrl(env)}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey(env), "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, status: res.status, message: data?.msg || data?.error_description || data?.error || "Đăng nhập thất bại." };
  }
  return { ok: true, session: data };
}

/** GoTrue Admin: đặt lại mật khẩu (chỉ admin, qua /api/auth/users). */
export async function adminSetPassword(env, userId, password) {
  const key = serviceKey(env);
  const res = await fetch(`${baseUrl(env)}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(data?.msg || data?.message || `GoTrue admin HTTP ${res.status}`);
    e.status = res.status >= 400 && res.status < 600 ? res.status : 500;
    throw e;
  }
  return data;
}

/** GoTrue Admin: thu hồi refresh token của phiên đang chạy (logout). */
export async function adminLogout(env, accessToken) {
  try {
    const key = serviceKey(env);
    await fetch(`${baseUrl(env)}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: anonKey(env),
        authorization: `Bearer ${accessToken || key}`,
        "content-type": "application/json"
      }
    });
  } catch (_) { /* logout best-effort */ }
}

export async function getProfileByEmail(env, email) {
  const rows = await rest(
    env,
    `profiles?select=id,email,role_name,is_active&email=eq.${encodeURIComponent(email)}&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

/**
 * Tìm profile theo ĐẦU VÀO ĐĂNG NHẬP — nhận cả email lẫn tên đăng nhập.
 *   - có '@'  -> tra theo email (giữ nguyên hành vi cũ)
 *   - không '@' -> tra theo profiles.username (không phân biệt hoa/thường),
 *     sau đó fallback phần trước '@' của email (user cũ).
 * Số user rất ít -> tải một lần rồi so trong JS, tránh so khớp sai
 * do ký tự '_' / '%' trong username bị PostgREST ilike coi là wildcard.
 */
export async function resolveLoginProfile(env, input) {
  const v = String(input || "").trim();
  if (!v) return null;
  if (v.includes("@")) return getProfileByEmail(env, v);

  const rows = await rest(env, "profiles?select=id,email,role_name,is_active,username&limit=1000");
  if (!Array.isArray(rows) || !rows.length) return null;

  const key = v.toLowerCase();
  return (
    rows.find((r) => String(r.username || "").trim().toLowerCase() === key) ||
    rows.find((r) => String(r.email || "").split("@")[0].trim().toLowerCase() === key) ||
    null
  );
}

export async function getProfileById(env, userId) {
  const rows = await rest(
    env,
    `profiles?select=id,email,role_name,is_active&id=eq.${encodeURIComponent(userId)}&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function getSecurity(env, userId) {
  const rows = await rest(env, `user_security?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

/** Ghi/đọc trạng thái khóa (tạo row nếu chưa có). */
export async function putSecurity(env, userId, patch) {
  const rows = await rest(env, `user_security?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: patch,
    headers: { prefer: "return=representation" }
  });
  if (Array.isArray(rows) && rows[0]) return rows[0];

  const created = await rest(env, `user_security`, {
    method: "POST",
    body: { user_id: userId, ...patch },
    headers: { prefer: "return=representation" }
  });
  return Array.isArray(created) ? created[0] || null : created;
}

/**
 * Xác thực access token + trả profile (đủ để biết role/is_active).
 * Ném lỗi 401 khi token sai/hết hạn.
 */
export async function requireUser(env, accessToken) {
  const me = await validateSession(env, accessToken);   // RPC app_me
  if (!me?.ok || !me?.user_id) {
    const e = new Error(me?.message || "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
    e.status = 401;
    throw e;
  }
  const profile = await getProfileById(env, me.user_id);
  return { me, profile };
}

export async function requireAdmin(env, accessToken) {
  const ctx = await requireUser(env, accessToken);
  const role = String(ctx.profile?.role_name || ctx.me?.role_name || "").toLowerCase();
  if (role !== "admin") {
    const e = new Error("Bạn chưa được cấp quyền, liên hệ admin.");
    e.status = 403;
    throw e;
  }
  return { ...ctx, role };
}

/** Mật khẩu tạm cho admin "cấp lại mật khẩu" (in 1 lần duy nhất). */
export function tempPassword() {
  // Không chứa ký tự dễ nhầm: O/0, I/l/1 — bắt buộc có chữ hoa, chữ thường, số.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 6)}Aa9${out.slice(6, 12)}`;
}

export function bearer(request) {
  const h = String(request.headers.get("authorization") || request.headers.get("Authorization") || "");
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : "";
}
