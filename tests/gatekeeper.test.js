import { describe, it, expect, beforeEach } from "vitest";
import {
  getCookieValue,
  renderCamouflage404Html,
  checkRateLimit,
  recordFailedGateAttempt,
  resetFailedGateAttempt,
  _clearRateLimitsForTesting,
  verifyTotp,
  createGateSession,
  validateGateSession,
  getNextDailyResetMs,
  DEFAULT_TOTP_SECRET
} from "../functions/_lib/gatekeeper.js";
import { onRequest } from "../functions/_middleware.js";

describe("Gatekeeper & Microsoft Authenticator (TOTP)", () => {
  beforeEach(() => {
    _clearRateLimitsForTesting();
  });

  it("trích xuất đúng cookie catalogue_session", () => {
    const cookies = "theme=dark; catalogue_session=gate.123.abc; lang=vi";
    expect(getCookieValue(cookies, "catalogue_session")).toBe("gate.123.abc");
    expect(getCookieValue(cookies, "missing")).toBe(null);
  });

  it("renderCamouflage404Html chứa trigger bí mật và giao diện Microsoft Authenticator", () => {
    const html = renderCamouflage404Html();
    expect(html).toContain("404 Not Found");
    expect(html).toContain("Ctrl");
    expect(html).toContain("portal");
    expect(html).toContain("touchstart"); // cử chỉ đè 3s điện thoại
    expect(html).toContain("3000"); // 3 giây
    expect(html).toContain('maxlength="10"'); // Hỗ trợ cả 6 số và 8 số
    expect(html).toContain("Authenticator"); // Chế độ Authenticator

    // Chống DevTools và xóa cache
    expect(html).toContain("contextmenu");
    expect(html).toContain("F12");
    expect(html).toContain("antiDebug");
    expect(html).toContain("serviceWorker");
    expect(html).not.toMatch(/<body[^>]*>[\s\S]*<div id="gateModal"/i);
  });

  it("tính toán mốc reset 07:00 sáng VN (00:00 UTC) hàng ngày", () => {
    const now = Date.now();
    const nextReset = getNextDailyResetMs(now);
    expect(nextReset).toBeGreaterThan(now);
    expect(nextReset - now).toBeLessThanOrEqual(86400000);
    // 00:00 UTC chia hết cho 86400_000
    expect(nextReset % 86400000).toBe(0);
  });

  it("tạo và xác thực Gatekeeper Token hết hạn lúc 07:00 sáng VN", async () => {
    const env = { CATALOGUE_TOTP_SECRET: DEFAULT_TOTP_SECRET };
    const session = await createGateSession(env);
    expect(session.token).toMatch(/^gate\.\d+\..+/);
    expect(session.maxAgeSeconds).toBeGreaterThan(0);

    // Xác thực token hợp lệ
    const isValid = await validateGateSession(env, session.token);
    expect(isValid).toBe(true);

    // Từ chối token bị sửa đổi hoặc giả mạo
    const isTampered = await validateGateSession(env, session.token + "fake");
    expect(isTampered).toBe(false);

    // Từ chối token đã quá hạn
    const expiredToken = `gate.${Date.now() - 1000}.fakeSig`;
    expect(await validateGateSession(env, expiredToken)).toBe(false);
  });

  it("từ chối mã Authenticator sai", async () => {
    const env = { CATALOGUE_TOTP_SECRET: DEFAULT_TOTP_SECRET };
    expect(await verifyTotp(env, "00000000")).toBe(false);
    expect(await verifyTotp(env, "123456")).toBe(false);
    expect(await verifyTotp(env, "")).toBe(false);
  });

  it("_middleware chặn người chưa mở cổng và trả về mã 404 ngụy trang", async () => {
    let nextCalled = false;
    const ctx = {
      request: new Request("https://dictionary-dnw.pages.dev/"),
      env: {},
      next: () => { nextCalled = true; return new Response("OK"); }
    };

    const res = await onRequest(ctx);
    expect(nextCalled).toBe(false);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("404 Not Found");
  });

  it("_middleware mở cổng khi có cookie Authenticator hợp lệ", async () => {
    const env = { CATALOGUE_TOTP_SECRET: DEFAULT_TOTP_SECRET };
    const session = await createGateSession(env);

    let nextCalled = false;
    const ctx = {
      request: new Request("https://dictionary-dnw.pages.dev/", {
        headers: { cookie: `catalogue_session=${session.token}` }
      }),
      env,
      next: () => { nextCalled = true; return new Response("OK"); }
    };

    const res = await onRequest(ctx);
    expect(nextCalled).toBe(true);
    expect(await res.text()).toBe("OK");
  });

  it("Lớp 2: Khóa IP vĩnh viễn nếu thử sai liên tiếp 5 lần", async () => {
    const mockReq = { headers: new Headers({ "cf-connecting-ip": "9.8.7.6" }) };
    for (let i = 0; i < 5; i++) {
      recordFailedGateAttempt("9.8.7.6");
    }
    const check = await checkRateLimit(mockReq);
    expect(check.ok).toBe(false);
    expect(check.status).toBe(423);
    expect(check.error).toBe("Thao tác quá nhiều, hãy thử lại sau");

    // Mở khóa IP
    await resetFailedGateAttempt("9.8.7.6");
    const checkAfter = await checkRateLimit(mockReq);
    expect(checkAfter.ok).toBe(true);
  });

  it("generateBase32Secret sinh chuỗi Base32 hợp lệ 32 ký tự", async () => {
    const { generateBase32Secret } = await import("../functions/_lib/gatekeeper.js");
    const secret = generateBase32Secret(32);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("createGateSession gắn userId và getGateSessionUser trích xuất đúng", async () => {
    const { getGateSessionUser } = await import("../functions/_lib/gatekeeper.js");
    const env = { CATALOGUE_TOTP_SECRET: DEFAULT_TOTP_SECRET };
    const session = await createGateSession(env, "user-uuid-123");
    expect(session.userId).toBe("user-uuid-123");
    expect(session.token).toMatch(/^gate\.\d+\.user-uuid-123\..+/);

    const isValid = await validateGateSession(env, session.token);
    expect(isValid).toBe(true);

    const extractedUser = getGateSessionUser(session.token);
    expect(extractedUser).toBe("user-uuid-123");
  });

  it("verifyTotp hoạt động với secretOverride riêng của user", async () => {
    const userSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    // Thử mã sai vẫn bị từ chối
    expect(await verifyTotp({}, "999999", 1, userSecret)).toBe(false);
  });

  it("/api/gate/verify-otp xác thực thành công cho pquangvinh1999@gmail.com và cấp cookie", async () => {
    const { base32ToBytes } = await import("../functions/_lib/gatekeeper.js");
    const { onRequestPost } = await import("../functions/api/gate/verify-otp.js");
    const cryptoObj = (typeof crypto !== "undefined" && crypto.subtle) ? crypto : (await import("crypto")).webcrypto;
    const keyBytes = base32ToBytes(DEFAULT_TOTP_SECRET);
    const cryptoKey = await cryptoObj.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const counter = Math.floor(Math.floor(Date.now() / 1000) / 30);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigUint64(0, BigInt(counter));
    const sig = await cryptoObj.subtle.sign("HMAC", cryptoKey, buf);
    const sigBytes = new Uint8Array(sig);
    const offset = sigBytes[sigBytes.length - 1] & 0x0f;
    const binary = ((sigBytes[offset] & 0x7f) << 24) | ((sigBytes[offset + 1] & 0xff) << 16) | ((sigBytes[offset + 2] & 0xff) << 8) | (sigBytes[offset + 3] & 0xff);
    const code = (binary % 1000000).toString().padStart(6, "0");

    const req = new Request("http://localhost/api/gate/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "test-agent" },
      body: JSON.stringify({ username: "pquangvinh1999@gmail.com", code })
    });
    const res = await onRequestPost({ request: req, env: { CATALOGUE_TOTP_SECRET: DEFAULT_TOTP_SECRET } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("catalogue_session=");
  });

  it("/api/gate/verify-otp xác thực thành công khi để trống username (khóa admin mặc định)", async () => {
    const { base32ToBytes } = await import("../functions/_lib/gatekeeper.js");
    const { onRequestPost } = await import("../functions/api/gate/verify-otp.js");
    const cryptoObj = (typeof crypto !== "undefined" && crypto.subtle) ? crypto : (await import("crypto")).webcrypto;
    const keyBytes = base32ToBytes(DEFAULT_TOTP_SECRET);
    const cryptoKey = await cryptoObj.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const counter = Math.floor(Math.floor(Date.now() / 1000) / 30);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigUint64(0, BigInt(counter));
    const sig = await cryptoObj.subtle.sign("HMAC", cryptoKey, buf);
    const sigBytes = new Uint8Array(sig);
    const offset = sigBytes[sigBytes.length - 1] & 0x0f;
    const binary = ((sigBytes[offset] & 0x7f) << 24) | ((sigBytes[offset + 1] & 0xff) << 16) | ((sigBytes[offset + 2] & 0xff) << 8) | (sigBytes[offset + 3] & 0xff);
    const code = (binary % 1000000).toString().padStart(6, "0");

    const req = new Request("http://localhost/api/gate/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "test-agent" },
      body: JSON.stringify({ username: "", code })
    });
    const res = await onRequestPost({ request: req, env: { CATALOGUE_TOTP_SECRET: DEFAULT_TOTP_SECRET } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
