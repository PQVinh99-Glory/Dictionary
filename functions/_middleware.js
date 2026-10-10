// =============================================================================
// functions/_middleware.js — Cổng Ngụy Trang (Camouflage Gate) bảo vệ toàn bộ web
// =============================================================================
import { getCookieValue, renderCamouflage404Html, validateGateSession, getGateSessionUser } from "./_lib/gatekeeper.js";
import { validateSession } from "./_lib/moris/v5/connectors/supabase.js";

// Cache kiểm tra trạng thái active của user cổng ngụy trang (30 giây)
const gateActiveCache = new Map();

async function isGateUserActive(env, userId) {
  if (!userId || userId === "admin") return true;
  const cached = gateActiveCache.get(userId);
  if (cached && Date.now() - cached.time < 30_000) {
    return cached.active;
  }
  try {
    const key = env?.SUPABASE_SERVICE_ROLE_KEY;
    const base = env?.SUPABASE_URL;
    if (!key || !base) return true;
    const res = await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_active&limit=1`, {
      headers: { apikey: key, authorization: `Bearer ${key}` }
    });
    if (!res.ok) return true;
    const rows = await res.json().catch(() => []);
    const active = Array.isArray(rows) && rows.length > 0 ? rows[0].is_active === true : false;
    gateActiveCache.set(userId, { active, time: Date.now() });
    return active;
  } catch (_) {
    return true;
  }
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. Cho phép các API của cổng xác thực chạy qua
  if (pathname.startsWith("/api/gate/")) {
    return next();
  }

  // 2. Kiểm tra Cookie phiên đăng nhập (catalogue_session)
  const cookieHeader = request.headers.get("cookie") || "";
  const token = getCookieValue(cookieHeader, "catalogue_session");

  let isAuthenticated = false;
  if (token && typeof token === "string") {
    // 2.1. Kiểm tra phiên Authenticator (mở cổng ngụy trang, làm mới 07:00 sáng hàng ngày)
    if (await validateGateSession(env, token)) {
      const uid = getGateSessionUser(token);
      if (await isGateUserActive(env, uid)) {
        isAuthenticated = true;
      }
    } else if (token.split(".").length === 3) {
      // 2.2. Kiểm tra phiên Supabase JWT từ /api/auth/login
      try {
        const me = await validateSession(env, token);
        if (me?.ok) {
          isAuthenticated = true;
        }
      } catch (_) {
        isAuthenticated = false;
      }
    }
  }

  // 3. Nếu đã xác thực hợp lệ -> "MỞ CỔNG", cho phép tải website và API thật
  if (isAuthenticated) {
    return next();
  }

  // 4. Nếu CHƯA XÁC THỰC (Người lạ / Bot / Chưa đăng nhập):
  // 4.1. Với API: trả về 404 JSON (không lộ bất kỳ thông tin nào)
  if (pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ ok: false, error: "404 Not Found" }), {
      status: 404,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow, noarchive"
      }
    });
  }

  // 4.2. Với các file tĩnh (js, css, hình ảnh, onnx...): chặn 404 để không rò rỉ mã nguồn
  const isStaticFile = /\.(js|mjs|css|png|jpg|jpeg|webp|svg|ico|wasm|onnx|json|webmanifest|map)$/i.test(pathname);
  if (isStaticFile) {
    return new Response("404 Not Found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow, noarchive"
      }
    });
  }

  // 4.3. Với tất cả lượt truy cập web (HTML): Trả về trang lỗi 404 ngụy trang
  return new Response(renderCamouflage404Html(), {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "x-robots-tag": "noindex, nofollow, noarchive, nosnippet"
    }
  });
}
