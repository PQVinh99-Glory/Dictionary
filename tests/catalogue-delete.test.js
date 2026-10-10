import { describe, it, expect, vi } from "vitest";
import { onRequestPost as handleBulkDelete } from "../functions/api/catalogue/bulk-delete.js";
import { onRequestPost as handleDeleteAll } from "../functions/api/catalogue/delete-all.js";

function makeJwt(role = "admin") {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ role, sub: "user-123", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `${header}.${payload}.signature`;
}

describe("Catalogue Delete Suite (Bulk Delete & Delete All)", () => {
  describe("/api/catalogue/bulk-delete", () => {
    it("từ chối 401 nếu thiếu session token", async () => {
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };
      const request = new Request("https://example.com/api/catalogue/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_ids: ["00000000-0000-0000-0000-000000000001"] })
      });
      const res = await handleBulkDelete({ request, env: mockEnv });
      expect(res.status).toBe(401);
    });

    it("từ chối 403 nếu tài khoản không phải admin (ví dụ converter/viewer)", async () => {
      const userJwt = makeJwt("converter");
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "converter" }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: userJwt, image_ids: ["00000000-0000-0000-0000-000000000001"] })
      });

      const res = await handleBulkDelete({ request, env: mockEnv });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("admin");

      globalThis.fetch = originalFetch;
    });

    it("cho phép admin xóa hàng loạt và gọi R2 delete dọn dẹp ảnh", async () => {
      const adminJwt = makeJwt("admin");
      let deletedKeys = [];
      const mockBucket = {
        delete: vi.fn().mockImplementation((keys) => {
          deletedKeys.push(...keys);
          return Promise.resolve();
        })
      };
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        CATALOGUE_BUCKET: mockBucket
      };

      let rpcCalled = "";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        const urlStr = String(url);
        if (urlStr.includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "admin" }), { status: 200 }));
        }
        if (urlStr.includes("/rpc/app_bulk_delete_parts")) {
          rpcCalled = "app_bulk_delete_parts";
          return Promise.resolve(new Response(JSON.stringify({
            ok: true,
            deleted_count: 2,
            r2_keys: ["front/M1/u1.webp", "thumb/M1/u2.webp"]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          session_token: adminJwt,
          image_ids: [
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002"
          ]
        })
      });

      const res = await handleBulkDelete({ request, env: mockEnv });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.deleted_count).toBe(2);
      expect(rpcCalled).toBe("app_bulk_delete_parts");
      expect(mockBucket.delete).toHaveBeenCalled();
      expect(deletedKeys).toContain("front/M1/u1.webp");
      expect(deletedKeys).toContain("thumb/M1/u2.webp");

      globalThis.fetch = originalFetch;
    });
  });

  describe("/api/catalogue/delete-all", () => {
    it("từ chối 403 nếu không phải admin", async () => {
      const userJwt = makeJwt("viewer");
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "viewer" }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/delete-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: userJwt, confirm: true })
      });

      const res = await handleDeleteAll({ request, env: mockEnv });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("admin");

      globalThis.fetch = originalFetch;
    });

    it("từ chối 400 nếu thiếu confirm=true", async () => {
      const adminJwt = makeJwt("admin");
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key"
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (String(url).includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "admin" }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/delete-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: adminJwt, confirm: false })
      });

      const res = await handleDeleteAll({ request, env: mockEnv });
      expect(res.status).toBe(400);

      globalThis.fetch = originalFetch;
    });

    it("cho phép admin xóa toàn bộ catalogue và làm sạch bucket R2", async () => {
      const adminJwt = makeJwt("admin");
      let deletedKeys = [];
      const mockBucket = {
        list: vi.fn().mockResolvedValue({
          objects: [{ key: "front/A1/1.webp" }, { key: "thumb/A1/2.webp" }],
          truncated: false
        }),
        delete: vi.fn().mockImplementation((keys) => {
          deletedKeys.push(...keys);
          return Promise.resolve();
        })
      };
      const mockEnv = {
        SUPABASE_URL: "https://test.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
        CATALOGUE_BUCKET: mockBucket
      };

      let rpcCalled = "";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        const urlStr = String(url);
        if (urlStr.includes("/rpc/app_me")) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, role_name: "admin" }), { status: 200 }));
        }
        if (urlStr.includes("/rpc/app_delete_all_parts")) {
          rpcCalled = "app_delete_all_parts";
          return Promise.resolve(new Response(JSON.stringify({
            ok: true,
            deleted_count: 50,
            r2_keys: ["front/A1/1.webp", "thumb/A1/2.webp"]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      });

      const request = new Request("https://example.com/api/catalogue/delete-all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_token: adminJwt, confirm: true })
      });

      const res = await handleDeleteAll({ request, env: mockEnv });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.deleted_count).toBe(50);
      expect(rpcCalled).toBe("app_delete_all_parts");
      expect(mockBucket.list).toHaveBeenCalled();
      expect(mockBucket.delete).toHaveBeenCalled();
      expect(deletedKeys).toContain("front/A1/1.webp");

      globalThis.fetch = originalFetch;
    });
  });
});
