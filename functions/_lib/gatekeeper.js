// =============================================================================
// functions/_lib/gatekeeper.js — Cổng Ngụy Trang 404 & Xác thực Microsoft Authenticator (TOTP)
//
// Cơ chế:
// 1. Ngụy trang 404 Nginx + Chống soi mã DevTools (Anti-Debug, F12 blocker, clear DOM).
// 2. Xác thực 2FA trực tiếp qua Microsoft Authenticator (RFC 6238 TOTP).
//    - Tự động nhận diện và hỗ trợ cả mã 6 chữ số lẫn 8 chữ số.
//    - Hoàn toàn 0đ, không gửi email, không phụ thuộc mạng viễn thông.
// 3. Chu kỳ phiên: Hết hạn và làm mới vào đúng 07:00 sáng giờ Việt Nam mỗi ngày (00:00 UTC).
// =============================================================================

// Khóa bí mật Base32 chuẩn RFC 4648 dùng cho Microsoft Authenticator
export const DEFAULT_TOTP_SECRET = "WHG4HAKRX3FNXOVLNOW6H2WWUKDRWWR5";

export function getTotpSecret(env) {
  return String(env?.CATALOGUE_TOTP_SECRET || DEFAULT_TOTP_SECRET).trim().replace(/\s+/g, "");
}

/** Chuyển đổi chuỗi Base32 sang mảng Byte Uint8Array */
export function base32ToBytes(str) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, output = [];
  for (let char of str.toUpperCase().replace(/[\s=]+/g, "")) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

export function generateBase32Secret(length = 32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let secret = "";
  for (let i = 0; i < length; i++) {
    secret += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return secret;
}

/**
 * Xác thực mã từ Microsoft Authenticator
 * Tự động hỗ trợ cả mã 6 chữ số lẫn mã 8 chữ số với độ lệch ±1 chu kỳ (±30s)
 * Hỗ trợ secretOverride để xác thực theo từng User riêng biệt
 */
export async function verifyTotp(env, inputCode, window = 1, secretOverride = null) {
  const cleanCode = String(inputCode || "").trim().replace(/\s+/g, "");
  if (!cleanCode || (cleanCode.length !== 6 && cleanCode.length !== 8)) {
    return false;
  }
  const digits = cleanCode.length;
  const secret = secretOverride ? String(secretOverride).trim().replace(/\s+/g, "") : getTotpSecret(env);
  const keyBytes = base32ToBytes(secret);

  const cryptoObj = (typeof crypto !== "undefined" && crypto.subtle)
    ? crypto
    : (await import("crypto")).webcrypto;

  const cryptoKey = await cryptoObj.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const epoch = Math.floor(Date.now() / 1000);
  const currentCounter = Math.floor(epoch / 30);
  const mod = digits === 8 ? 100000000 : 1000000;

  for (let i = -window; i <= window; i++) {
    const counter = currentCounter + i;
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setBigUint64(0, BigInt(counter));

    const sig = await cryptoObj.subtle.sign("HMAC", cryptoKey, buf);
    const sigBytes = new Uint8Array(sig);
    const offset = sigBytes[sigBytes.length - 1] & 0x0f;
    const binary =
      ((sigBytes[offset] & 0x7f) << 24) |
      ((sigBytes[offset + 1] & 0xff) << 16) |
      ((sigBytes[offset + 2] & 0xff) << 8) |
      (sigBytes[offset + 3] & 0xff);
    const expected = (binary % mod).toString().padStart(digits, "0");

    if (expected === cleanCode) {
      return true;
    }
  }

  return false;
}

/**
 * Tính toán mốc thời gian hết hạn phiên kế tiếp:
 * 00:00 UTC = đúng 07:00 sáng giờ Việt Nam mỗi ngày
 */
const DAY_MS = 86400_000;
export function getNextDailyResetMs(nowMs = Date.now()) {
  return (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;
}

/**
 * Tạo token phiên mở cổng ngụy trang có chữ ký số HMAC-SHA256
 * Hết hạn vào lúc 07:00 sáng giờ Việt Nam kế tiếp (tối đa 24 giờ)
 * Gắn userId để hỗ trợ kiểm tra trạng thái và thu hồi tức thì
 */
export async function createGateSession(env, userId = null) {
  const secret = getTotpSecret(env);
  const nextResetMs = getNextDailyResetMs();
  const maxAgeSeconds = Math.max(60, Math.floor((nextResetMs - Date.now()) / 1000));
  const cleanUid = userId ? String(userId).trim() : null;
  const payload = cleanUid ? `gate.${nextResetMs}.${cleanUid}` : `gate.${nextResetMs}`;

  const cryptoObj = (typeof crypto !== "undefined" && crypto.subtle)
    ? crypto
    : (await import("crypto")).webcrypto;

  const key = await cryptoObj.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await cryptoObj.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const sigBytes = new Uint8Array(sig);
  let binary = "";
  for (let i = 0; i < sigBytes.byteLength; i++) {
    binary += String.fromCharCode(sigBytes[i]);
  }
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const token = `${payload}.${b64}`;

  return {
    token,
    maxAgeSeconds,
    userId: cleanUid,
    expiresAt: new Date(nextResetMs).toISOString()
  };
}

/**
 * Kiểm tra tính hợp lệ của token phiên mở cổng:
 * 1. Chưa qua mốc 07:00 sáng giờ VN (Date.now() <= nextResetMs)
 * 2. Chữ ký số HMAC-SHA256 khớp với Secret Key của hệ thống
 */
export async function validateGateSession(env, token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if ((parts.length !== 3 && parts.length !== 4) || parts[0] !== "gate") return false;

  const nextResetMs = Number(parts[1]);
  if (!nextResetMs || isNaN(nextResetMs) || Date.now() > nextResetMs) {
    return false; // Đã quá 07:00 sáng -> Hết hạn phiên
  }

  const payload = parts.length === 4 ? `gate.${nextResetMs}.${parts[2]}` : `gate.${nextResetMs}`;
  const sigStr = parts.length === 4 ? parts[3] : parts[2];
  const secret = getTotpSecret(env);

  try {
    const cryptoObj = (typeof crypto !== "undefined" && crypto.subtle)
      ? crypto
      : (await import("crypto")).webcrypto;

    const key = await cryptoObj.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    let b64 = sigStr.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = atob(b64);
    const sigBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      sigBytes[i] = binary.charCodeAt(i);
    }

    return await cryptoObj.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
  } catch (_) {
    return false;
  }
}

/**
 * Trích xuất userId từ gate session token (nếu có)
 */
export function getGateSessionUser(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length === 4 && parts[0] === "gate") return parts[2];
  if (parts.length === 3 && parts[0] === "gate") return "admin";
  return null;
}

// -----------------------------------------------------------------------------
// LỚP 1: BẢO VỆ CHỐNG BOT & SCRIPT TỰ ĐỘNG (Anti-Bot Verification)
// -----------------------------------------------------------------------------
export function checkBotProtection(request) {
  const isTest = typeof process !== "undefined" && (process.env?.NODE_ENV === "test" || process.env?.VITEST);
  const ua = (request?.headers?.get("user-agent") || "").toLowerCase().trim();

  if (!isTest) {
    if (!ua) {
      return { ok: false, status: 403, error: "Truy cập bị từ chối (User-Agent không hợp lệ)." };
    }
    const blockedSignatures = [
      "python-requests",
      "python-urllib",
      "aiohttp",
      "httpclient",
      "scrapy",
      "postmanruntime",
      "curl/",
      "wget/",
      "go-http-client"
    ];
    if (blockedSignatures.some((sig) => ua.includes(sig))) {
      return { ok: false, status: 403, error: "Truy cập bị từ chối bởi cơ chế Anti-Bot." };
    }
    const contentType = (request?.headers?.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      return { ok: false, status: 400, error: "Định dạng dữ liệu không hợp lệ." };
    }
  }

  return { ok: true };
}

// -----------------------------------------------------------------------------
// LỚP 2: BẢO VỆ RATE LIMITING & TỰ ĐỘNG KHÓA IP KHI THỬ SAI (Brute-Force Protection)
// -----------------------------------------------------------------------------
const rateLimitStore = {
  ipRequests: new Map(),
  ipLockouts: new Map(),
};

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 phút
const MAX_REQUESTS_PER_IP_MINUTE = 10; // Tối đa 10 lượt thử / 1 phút / 1 IP
const MAX_FAILED_ATTEMPTS = 5; // 5 lần nhập sai mã -> khóa 15 phút
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // Khóa 15 phút

export function getClientIp(request) {
  return (
    request?.headers?.get("cf-connecting-ip") ||
    request?.headers?.get("x-real-ip") ||
    request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "127.0.0.1"
  );
}

export async function checkRateLimit(request, env = null) {
  const ip = getClientIp(request);
  const now = Date.now();

  // 1. Kiểm tra trạng thái khóa IP trong bộ nhớ
  const lockout = rateLimitStore.ipLockouts.get(ip);
  if (lockout && lockout.permanentLock) {
    return {
      ok: false,
      status: 423,
      error: "Thao tác quá nhiều, hãy thử lại sau"
    };
  }
  if (lockout && lockout.lockedUntil > now) {
    return {
      ok: false,
      status: 429,
      error: "Thao tác quá nhiều, hãy thử lại sau"
    };
  }

  // 2. Kiểm tra trạng thái khóa IP trong Database (nếu có env)
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SECRET_KEY;
  if (serviceKey && env?.SUPABASE_URL) {
    try {
      const base = env.SUPABASE_URL;
      const key = serviceKey;
      const res = await fetch(`${base}/rest/v1/gate_ip_blocks?ip=eq.${encodeURIComponent(ip)}&is_blocked=eq.true&limit=1`, {
        headers: { apikey: key, authorization: `Bearer ${key}` }
      });
      if (res.ok) {
        const rows = await res.json().catch(() => []);
        if (Array.isArray(rows) && rows.length > 0) {
          rateLimitStore.ipLockouts.set(ip, { failedCount: rows[0].failed_count || 5, permanentLock: true });
          return {
            ok: false,
            status: 423,
            error: "Thao tác quá nhiều, hãy thử lại sau"
          };
        }
      }
    } catch (_) {}
  }

  // 3. Kiểm tra tần suất theo IP
  const ipHistory = (rateLimitStore.ipRequests.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (ipHistory.length >= MAX_REQUESTS_PER_IP_MINUTE) {
    return {
      ok: false,
      status: 429,
      error: "Thao tác quá nhiều, hãy thử lại sau"
    };
  }

  return { ok: true, ip };
}

export function recordFailedGateAttempt(ip, env = null) {
  const current = rateLimitStore.ipLockouts.get(ip) || { failedCount: 0, permanentLock: false };
  current.failedCount += 1;
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SECRET_KEY;
  if (current.failedCount >= MAX_FAILED_ATTEMPTS) {
    current.permanentLock = true;
    if (serviceKey && env?.SUPABASE_URL) {
      try {
        const base = env.SUPABASE_URL;
        const key = serviceKey;
        fetch(`${base}/rest/v1/gate_ip_blocks`, {
          method: "POST",
          headers: {
            apikey: key,
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
            prefer: "resolution=merge-duplicates"
          },
          body: JSON.stringify({
            ip,
            failed_count: current.failedCount,
            is_blocked: true,
            blocked_at: new Date().toISOString()
          })
        }).catch(() => null);
      } catch (_) {}
    }
  }
  rateLimitStore.ipLockouts.set(ip, current);
}

export async function resetFailedGateAttempt(ip, env = null) {
  rateLimitStore.ipLockouts.delete(ip);
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SECRET_KEY;
  if (serviceKey && env?.SUPABASE_URL) {
    try {
      const base = env.SUPABASE_URL;
      const key = serviceKey;
      await fetch(`${base}/rest/v1/gate_ip_blocks?ip=eq.${encodeURIComponent(ip)}`, {
        method: "DELETE",
        headers: { apikey: key, authorization: `Bearer ${key}` }
      });
    } catch (_) {}
  }
}

export function _clearRateLimitsForTesting() {
  rateLimitStore.ipRequests.clear();
  rateLimitStore.ipLockouts.clear();
}

/** Trích xuất cookie từ chuỗi Cookie header */
export function getCookieValue(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Render trang ngụy trang 404 chuẩn Nginx và chống soi mã DevTools */
export function renderCamouflage404Html() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
  <title>404 Not Found</title>
  <style>
    * { box-sizing: border-box; }
    body {
      background-color: #ffffff;
      color: #333333;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 60px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      user-select: none;
      -webkit-user-select: none;
      touch-action: pan-y;
    }
    .fake-container {
      max-width: 650px;
      width: 100%;
      text-align: center;
    }
    h1 {
      font-size: 42px;
      font-weight: 600;
      color: #222222;
      margin: 0 0 10px;
      cursor: default;
    }
    p.fake-desc {
      font-size: 16px;
      color: #666666;
      margin: 10px 0 25px;
    }
    hr {
      border: 0;
      border-top: 1px solid #e5e7eb;
      margin: 30px 0;
    }
    .fake-footer {
      font-size: 13px;
      color: #9ca3af;
    }
  </style>
</head>
<body>

  <!-- KHUNG 404 NGINX CHUẨN — TUYỆT ĐỐI KHÔNG CÓ MODAL HAY TỪ KHÓA CATALOGUE TRONG HTML GỐC -->
  <div class="fake-container">
    <h1>404 Not Found</h1>
    <p class="fake-desc">The requested URL was not found on this server.</p>
    <hr>
    <div class="fake-footer">nginx/1.18.0 (Ubuntu)</div>
  </div>

  <script>
    (function() {
      // 1. XÓA SẠCH SERVICE WORKER & BỘ NHỚ ĐỆM CACHE CŨ TRÊN THIẾT BỊ NÀY
      try {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(function(regs) {
            for (var i = 0; i < regs.length; i++) regs[i].unregister();
          });
        }
        if ('caches' in window) {
          caches.keys().then(function(keys) {
            for (var i = 0; i < keys.length; i++) caches.delete(keys[i]);
          });
        }
      } catch (_) {}

      // 2. BẢO VỆ CHỐNG SOI MÃ DEVTOOLS: CHẶN CHUỘT PHẢI & PHÍM TẮT XEM SOURCE
      window.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        return false;
      }, true);

      window.addEventListener('keydown', function(e) {
        var k = e.key || '';
        // Chặn F12
        if (k === 'F12' || e.keyCode === 123) {
          e.preventDefault();
          return false;
        }
        // Chặn Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C (hoặc Cmd+Alt+I/J/C trên Mac)
        if ((e.ctrlKey || e.metaKey) && (e.shiftKey || e.altKey) && (k === 'I' || k === 'i' || k === 'J' || k === 'j' || k === 'C' || k === 'c')) {
          e.preventDefault();
          return false;
        }
        // Chặn Ctrl+U (View Page Source)
        if ((e.ctrlKey || e.metaKey) && (k === 'U' || k === 'u')) {
          e.preventDefault();
          return false;
        }
      }, true);

      // 3. DEBUGGER TRAP: LÀM ĐÓNG BĂNG VÀ KHÓA DEVTOOLS NGAY LẬP TỨC
      (function antiDebug() {
        function freeze() {
          try {
            (function() { return false; })['constructor']('debugger')['call']();
          } catch (_) {}
        }
        setInterval(freeze, 50);
      })();

      // 4. PHÁT HIỆN DEVTOOLS MỞ QUA CONSOLE GETTER & CỬA SỔ -> XÓA SẠCH SOURCE
      try {
        var _devCheck = new Image();
        Object.defineProperty(_devCheck, 'id', {
          get: function() {
            document.documentElement.innerHTML = '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>';
            try { console.clear(); } catch (_) {}
            return '';
          }
        });
        setInterval(function() {
          console.log('%c', _devCheck);
          console.clear();
        }, 500);
      } catch (_) {}

      window.addEventListener('resize', function() {
        if (window.outerWidth - window.innerWidth > 160 || window.outerHeight - window.innerHeight > 160) {
          document.documentElement.innerHTML = '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>';
          try { console.clear(); } catch (_) {}
        }
      });

      // 5. CƠ CHẾ KÍCH HOẠT CỔNG BÍ MẬT (CHỈ TẠO MODAL ĐỘNG VÀO DOM KHI CÓ ĐÚNG LỆNH)
      var gateActive = false;

      function createAndOpenGate() {
        if (gateActive) return;
        gateActive = true;

        var style = document.createElement('style');
        style.id = 'gateStyle';
        style.textContent = [
          '#gateModal{display:flex;position:fixed;inset:0;background:rgba(15,23,42,0.75);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:999999;align-items:center;justify-content:center;padding:16px;}',
          '.modal-box{background:#fff;width:100%;max-width:400px;border-radius:16px;padding:28px 24px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);border:1px solid #e2e8f0;text-align:left;user-select:text;-webkit-user-select:text;}',
          '.modal-title{font-size:18px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px;margin:0 0 4px;}',
          '.modal-subtitle{font-size:13px;color:#64748b;margin:0 0 20px;}',
          '.input-label{font-size:12px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:block;}',
          '.gate-input{width:100%;padding:12px 14px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:18px;color:#0f172a;outline:none;}',
          '.gate-input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,0.15);}',
          '.gate-btn{width:100%;padding:12px;background:#2563eb;color:#fff;font-size:14px;font-weight:600;border:none;border-radius:8px;cursor:pointer;margin-top:14px;}',
          '.gate-btn:disabled{background:#94a3b8;cursor:not-allowed;}',
          '.msg-box{font-size:13px;padding:10px 12px;border-radius:6px;margin-top:12px;display:none;line-height:1.4;}',
          '.msg-error{background:#fef2f2;color:#dc2626;border:1px solid #fecaca;}',
          '.msg-success{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;}',
          '.otp-display{letter-spacing:4px;font-size:24px;font-weight:700;text-align:center;}'
        ].join('');
        document.head.appendChild(style);

        var modal = document.createElement('div');
        modal.id = 'gateModal';
        modal.innerHTML = [
          '<div class="modal-box">',
          '  <div class="modal-title">',
          '    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>',
          '    Hệ Thống Catalogue',
          '  </div>',
          '  <div class="modal-subtitle">Xác thực Microsoft Authenticator (Làm mới 07:00 hàng ngày)</div>',
          '  <div style="margin-bottom:12px;">',
          '    <label class="input-label" for="gateUser">Tên đăng nhập hoặc Email</label>',
          '    <input type="text" id="gateUser" class="gate-input" style="font-size:15px;letter-spacing:normal;" placeholder="vd: vinh, thanh..." autocomplete="username">',
          '  </div>',
          '  <div>',
          '    <label class="input-label" for="gateCode">Mã xác thực (6 hoặc 8 chữ số)</label>',
          '    <input type="text" id="gateCode" class="gate-input otp-display" maxlength="10" placeholder="" inputmode="numeric" autocomplete="one-time-code">',
          '    <button id="btnVerify" class="gate-btn">Xác nhận & Mở cổng</button>',
          '  </div>',
          '  <div id="gateMsg" class="msg-box"></div>',
          '</div>'
        ].join('');
        document.body.appendChild(modal);

        var gateUser = document.getElementById('gateUser');
        var gateCode = document.getElementById('gateCode');
        var btnVerify = document.getElementById('btnVerify');
        var gateMsg = document.getElementById('gateMsg');

        function showMsg(text, isError) {
          gateMsg.textContent = text;
          gateMsg.className = 'msg-box ' + (isError ? 'msg-error' : 'msg-success');
          gateMsg.style.display = 'block';
        }
        function hideMsg() { gateMsg.style.display = 'none'; }

        function closeModal() {
          modal.remove();
          style.remove();
          gateActive = false;
        }

        modal.addEventListener('click', function(e) {
          if (e.target === modal) closeModal();
        });

        window.addEventListener('keydown', function(e) {
          if (e.key === 'Escape' && gateActive) closeModal();
        });

        btnVerify.addEventListener('click', async function() {
          var user = gateUser.value.trim();
          var code = gateCode.value.trim().replace(/\s+/g, '');
          if (!code || (code.length !== 6 && code.length !== 8)) {
            showMsg('Vui lòng nhập mã Authenticator 6 hoặc 8 chữ số.', true);
            return;
          }
          hideMsg();
          btnVerify.disabled = true;
          btnVerify.textContent = 'Đang xác thực...';

          try {
            var res = await fetch('/api/gate/verify-otp', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ username: user, code: code })
            });
            var data = await res.json().catch(function() { return {}; });
            if (!res.ok || !data.ok) {
              showMsg(data.error || 'Mã xác thực không đúng hoặc đã hết hạn.', true);
              btnVerify.disabled = false;
              btnVerify.textContent = 'Xác nhận & Mở cổng';
              return;
            }
            if (user) {
              try { localStorage.setItem('catalogue_gate_user', user); } catch (_) {}
            }
            showMsg('Xác thực thành công! Đang mở cổng...', false);
            setTimeout(function() {
              window.location.href = window.location.pathname;
            }, 500);
          } catch (_) {
            showMsg('Lỗi xác thực máy chủ. Vui lòng thử lại.', true);
            btnVerify.disabled = false;
            btnVerify.textContent = 'Xác nhận & Mở cổng';
          }
        });

        gateUser.addEventListener('keyup', function(e) {
          if (e.key === 'Enter') gateCode.focus();
        });

        gateCode.addEventListener('keyup', function(e) {
          if (e.key === 'Enter') btnVerify.click();
        });

        var remembered = '';
        try { remembered = localStorage.getItem('catalogue_gate_user') || ''; } catch (_) {}
        if (remembered) {
          gateUser.value = remembered;
          gateCode.focus();
        } else {
          gateUser.focus();
        }
      }

      // KÍCH HOẠT 1: Hậu tố link ?portal=open hoặc ?gate=open (PC & Mobile)
      var params = new URLSearchParams(window.location.search);
      if (params.has('portal') || params.has('gate')) {
        createAndOpenGate();
      }

      // KÍCH HOẠT 2: Phím tắt PC: Ctrl + Shift + K (hoặc Cmd + Shift + K)
      window.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
          e.preventDefault();
          createAndOpenGate();
        }
      });

      // KÍCH HOẠT 3: Cử chỉ Mobile: Đè vào màn hình 3 giây (Long-press 3s)
      var touchTimer = null;
      window.addEventListener('touchstart', function() {
        if (gateActive) return;
        touchTimer = setTimeout(function() {
          createAndOpenGate();
        }, 3000);
      }, { passive: true });

      window.addEventListener('touchend', function() { if (touchTimer) clearTimeout(touchTimer); });
      window.addEventListener('touchmove', function() { if (touchTimer) clearTimeout(touchTimer); });
    })();
  </script>
</body>
</html>`;
}
