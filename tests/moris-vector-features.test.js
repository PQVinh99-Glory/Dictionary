import { describe, it, expect, vi } from "vitest";
import { onRequestPost as handleVectorPurge } from "../functions/api/moris/vector-purge.js";
import { onRequestGet as handleVectorItems } from "../functions/api/moris/vector-items.js";
import { onRequestGet as handleMediaGet } from "../functions/api/media/[[path]].js";
import { createGateSession, DEFAULT_TOTP_SECRET } from "../functions/_lib/gatekeeper.js";
import fs from "node:fs";
import path from "node:path";

function makeJwt(role = "admin") {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ role, sub: "user-123", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.signature`;
}

describe("Moris Vector Center — Purge, Items, Duplicates & Media", () => {
  it("vector-purge: từ chối nếu không phải admin", async () => {
    const userJwt = makeJwt("viewer");
    const mockEnv = {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "anon-key"
    };

    // Mock validateSession via global fetch to Supabase
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (String(url).includes("/rpc/app_me")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "viewer" }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const request = new Request("https://example.com/api/moris/vector-purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_token: userJwt })
    });

    const res = await handleVectorPurge({ request, env: mockEnv });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("admin");

    globalThis.fetch = originalFetch;
  });

  it("vector-purge: gọi RPC purge thành công khi là admin", async () => {
    const adminJwt = makeJwt("admin");
    const mockEnv = {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "anon-key"
    };

    let rpcCalled = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      const urlStr = String(url);
      if (urlStr.includes("/rpc/app_me")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "admin" }), { status: 200 }));
      }
      if (urlStr.includes("/rpc/kim_purge_all_catalogue_image_vectors")) {
        rpcCalled = "kim_purge_all_catalogue_image_vectors";
        return Promise.resolve(new Response(JSON.stringify({ ok: true, message: "Đã xóa toàn bộ vector thành công." }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const request = new Request("https://example.com/api/moris/vector-purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_token: adminJwt })
    });

    const res = await handleVectorPurge({ request, env: mockEnv });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(rpcCalled).toBe("kim_purge_all_catalogue_image_vectors");

    globalThis.fetch = originalFetch;
  });

  it("vector-items: trả về danh sách part và đánh dấu has_vector chính xác", async () => {
    const token = makeJwt("admin");
    const mockEnv = {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "anon-key"
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url) => {
      const urlStr = String(url);
      if (urlStr.includes("/rpc/app_me")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "admin" }), { status: 200 }));
      }
      if (urlStr.includes("/rpc/app_search_catalogue")) {
        return Promise.resolve(new Response(JSON.stringify([
          { id: "part-1", code: "CODE-A", usage_side: "left", view_mode: "single_face", thumb_path: "p1.jpg" },
          { id: "part-2", code: "CODE-B", usage_side: "right", view_mode: "dual_face", thumb_path: "p2.jpg" }
        ]), { status: 200 }));
      }
      if (urlStr.includes("/rpc/kim_list_vector_record_ids")) {
        // Chỉ part-1 có vector trong DB
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          items: [{ record_id: "part-1", asset_type: "front", object_key: "p1.jpg" }]
        }), { status: 200 }));
      }
      if (urlStr.includes("/rpc/app_get_part_assets")) {
        const bodyStr = String(options?.body || "");
        const isPart2 = bodyStr.includes('"part-2"');
        return Promise.resolve(new Response(JSON.stringify([
          { asset_type: "front", image_path: isPart2 ? "p2.jpg" : "p1.jpg" }
        ]), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const request = new Request(`https://example.com/api/moris/vector-items?session_token=${token}&limit=10`);
    const res = await handleVectorItems({ request, env: mockEnv });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.items.length).toBe(2);

    const part1 = data.items.find(i => i.id === "part-1");
    const part2 = data.items.find(i => i.id === "part-2");
    expect(part1.has_vector).toBe(true);
    expect(part2.has_vector).toBe(false);

    globalThis.fetch = originalFetch;
  });

  it("api/media: hỗ trợ Gatekeeper cookie (catalogue_session) không cần Supabase JWT", async () => {
    const env = {
      CATALOGUE_TOTP_SECRET: DEFAULT_TOTP_SECRET,
      CATALOGUE_BUCKET: {
        get: vi.fn().mockResolvedValue({
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("fake-image-bytes"));
              controller.close();
            }
          }),
          writeHttpMetadata: (headers) => headers.set("content-type", "image/jpeg"),
          httpEtag: '"12345"',
          size: 16
        })
      }
    };

    const gate = await createGateSession(env);
    const request = new Request("https://example.com/api/media/catalogue/test.jpg", {
      headers: {
        Cookie: `catalogue_session=${gate.token}`
      }
    });

    const res = await handleMediaGet({
      request,
      env,
      params: { path: ["catalogue", "test.jpg"] }
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("moris-vector-center.html đồng bộ font chữ và bảng màu Wine Red/Sand với app chính", () => {
    const htmlPath = path.resolve(__dirname, "../tools/moris-vector-center.html");
    const html = fs.readFileSync(htmlPath, "utf-8");

    // Font chữ 'Aptos Narrow' đồng bộ
    expect(html).toContain("font-family: 'Aptos Narrow'");
    // Script bộ màu hệ thống Wine Red & Sand
    expect(html).toContain("#7F011F"); // Wine Red
    expect(html).toContain("#C7971B"); // Sand
    // Modal xóa toàn bộ vector
    expect(html).toContain('id="purgeModal"');
    expect(html).toContain('id="btnOpenPurgeModal"');
    expect(html).toContain('id="btnConfirmPurge"');
    // Danh sách items chờ tách vector
    expect(html).toContain('id="itemsTableBody"');
    expect(html).toContain('id="btnBatchVectorize"');

    // UI nổi: Toast và Confirm modal
    expect(html).toContain('id="toastContainer"');
    expect(html).toContain('id="confirmModal"');

    // Bảng không chứa cột ảnh để tránh lag
    expect(html).not.toContain('<th class="p-3">Ảnh</th>');

    // Đã xóa nút "Về Catalogue" và đã xóa Section 4 tiến trình batch trùng lặp
    expect(html).not.toContain('Về Catalogue');
    expect(html).not.toContain('Tiến trình chạy theo Batch (Tất cả Catalogue)');
  });

  it("moris-vector-center.js không dùng alert/confirm trình duyệt, dùng UI nổi và virtual scroll 20 mã", () => {
    const jsPath = path.resolve(__dirname, "../tools/moris-vector-center.js");
    const js = fs.readFileSync(jsPath, "utf-8");

    // Tuyệt đối không dùng alert/confirm native của trình duyệt
    expect(js).not.toMatch(/\balert\s*\(/);
    expect(js).not.toMatch(/\bconfirm\s*\(/);

    // Có hàm UI nổi
    expect(js).toContain("function showToast(");
    expect(js).toContain("function showConfirm(");

    // Giới hạn ban đầu 20 mã và logic cuộn về đầu trang thu gọn 20 mã
    expect(js).toContain("visibleLimit: 20");
    expect(js).toContain("scrollTop <= 10");
  });

  it("index.html đã bỏ header dư thừa và nút Mở tab của modal Vector AI", () => {
    const indexPath = path.resolve(__dirname, "../index.html");
    const html = fs.readFileSync(indexPath, "utf-8");

    // Modal Vector Center không còn header dư thừa và nút Mở tab
    expect(html).not.toContain('title="Mở trong tab riêng"');
    expect(html).not.toContain('<h3 class="text-sm sm:text-base font-black text-slate-800 truncate">Trung tâm Vector AI</h3>');
  });
});
