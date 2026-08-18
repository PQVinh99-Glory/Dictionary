// CRUD endpoint cho Kim v6 Admin Config: quản lý providers + API keys.
// GET  /api/kim/admin/providers       → list all providers (mask api_key)
// POST /api/kim/admin/providers       → create new provider
// PUT  /api/kim/admin/providers/:id   → update provider
// DELETE /api/kim/admin/providers/:id → delete provider
//
// Bảo mật: chỉ chấp nhận request có KIM_ADMIN_TOKEN hoặc session_token hợp lệ.
// API key được mã hóa AES-256-GCM trước khi lưu vào DB.
//
// Schema v2 (sql/004_kim_provider_config_v2.sql):
//   provider_id, name, display_name, base_url, api_protocol,
//   api_key_encrypted, models, is_active, priority

import { json, readJson } from "../../../_lib/shared/http.js";

const VALID_PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"];
const VALID_ROLES = ["vision", "orchestrator", "synthesizer", "fallback", "lightweight"];
const ENCRYPTION_KEY_ENV = "KIM_CONFIG_ENCRYPTION_KEY";

function getAdminToken(env) {
  return String(env.KIM_ADMIN_TOKEN || "").trim();
}

function getEncryptionKey(env) {
  const hex = String(env[ENCRYPTION_KEY_ENV] || "").trim();
  if (!hex || hex.length !== 64) return null;
  try {
    return Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
  } catch {
    return null;
  }
}

async function encryptApiKey(plaintext, keyBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
  const toBase64 = (arr) => btoa(String.fromCharCode(...arr));
  return `${toBase64(iv)}:${toBase64(ciphertext)}`;
}

function maskKey(encrypted) {
  if (!encrypted || encrypted === "PLACEHOLDER_ENCRYPTED_KEY") return "***CHƯA_CẤU_HÌNH***";
  return "***ĐÃ_MÃ_HÓA***";
}

async function validateAdminAccess(request, env) {
  const adminToken = getAdminToken(env);
  const headerToken = String(request.headers.get("x-kim-admin-token") || "").trim();

  if (adminToken && headerToken === adminToken) return true;

  const sessionToken = String(
    request.headers.get("x-session-token") || ""
  ).trim();
  if (sessionToken) {
    try {
      const { validateSession } = await import("../../../_lib/kim/v5/connectors/supabase.js");
      await validateSession(env, sessionToken);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function supabaseService(env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!url || !key) throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY");
  return { url, key };
}

// Validate + sanitize provider payload from client
function sanitizeProviderBody(body) {
  const out = {};

  const providerId = String(body.provider_id || body.providerId || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  const name = String(body.name || "").trim().slice(0, 120);
  const displayName = String(body.display_name || body.displayName || name || providerId).trim().slice(0, 120);
  const baseUrl = String(body.base_url || body.baseURL || "").trim().slice(0, 500);
  const protocol = String(body.api_protocol || body.protocol || "openai-completions").trim();

  if (!providerId) return { error: "Thiếu Provider ID." };
  if (!name && !displayName) return { error: "Thiếu tên provider." };
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) return { error: "Base URL không hợp lệ (cần bắt đầu bằng http:// hoặc https://)." };
  if (!VALID_PROTOCOLS.includes(protocol)) return { error: `API protocol phải là: ${VALID_PROTOCOLS.join(", ")}` };

  out.provider_id = providerId;
  out.name = name || providerId;
  out.display_name = displayName;
  out.base_url = baseUrl;
  out.api_protocol = protocol;

  // Models: sanitize array
  const models = Array.isArray(body.models) ? body.models : [];
  out.models = models.slice(0, 100).map(m => ({
    id: String(m.id || "").trim().slice(0, 200),
    roles: (Array.isArray(m.roles) ? m.roles : []).filter(r => VALID_ROLES.includes(r)),
    contextWindow: Number(m.contextWindow) || undefined
  })).filter(m => m.id);

  if (body.priority !== undefined) out.priority = Number(body.priority) || 0;
  if (body.is_active !== undefined) out.is_active = !!body.is_active;

  return { value: out };
}

// --- Handlers ---

export async function onRequestGet({ request, env }) {
  if (!(await validateAdminAccess(request, env))) {
    return json({ ok: false, message: "Unauthorized" }, 401);
  }

  try {
    const { url, key } = supabaseService(env);
    const res = await fetch(`${url}/rest/v1/kim_provider_config?select=*&order=priority.asc`, {
      headers: { apikey: key, authorization: `Bearer ${key}` }
    });
    if (!res.ok) throw new Error(`DB error ${res.status}`);
    const rows = await res.json();

    const safe = rows.map(r => ({
      id: r.id,
      provider_id: r.provider_id || r.name,
      name: r.name,
      display_name: r.display_name || r.name,
      base_url: r.base_url,
      api_protocol: r.api_protocol || "openai-completions",
      models: r.models,
      is_active: r.is_active,
      priority: r.priority,
      api_key_status: maskKey(r.api_key_encrypted),
      created_at: r.created_at,
      updated_at: r.updated_at
    }));

    return json({ ok: true, providers: safe, valid_protocols: VALID_PROTOCOLS, valid_roles: VALID_ROLES });
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await validateAdminAccess(request, env))) {
    return json({ ok: false, message: "Unauthorized" }, 401);
  }

  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ ok: false, message: "Invalid JSON" }, 400);
  }

  const encKey = getEncryptionKey(env);
  if (!encKey) {
    return json({ ok: false, message: "Server chưa cấu hình KIM_CONFIG_ENCRYPTION_KEY" }, 500);
  }

  const apiKey = String(body.api_key || "").trim();
  const sanitized = sanitizeProviderBody(body);
  if (sanitized.error) return json({ ok: false, message: sanitized.error }, 400);
  const payload = sanitized.value;

  if (!apiKey) {
    return json({ ok: false, message: "Thiếu api_key." }, 400);
  }
  if (!payload.models.length) {
    return json({ ok: false, message: "Cần ít nhất 1 model với role hợp lệ." }, 400);
  }

  try {
    payload.api_key_encrypted = await encryptApiKey(apiKey, encKey);
    const { url, key } = supabaseService(env);
    const res = await fetch(`${url}/rest/v1/kim_provider_config`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
        prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (text.includes("unique") || text.includes("duplicate")) {
        return json({ ok: false, message: `Provider '${payload.provider_id}' đã tồn tại.` }, 409);
      }
      throw new Error(`DB error ${res.status}: ${text}`);
    }

    const [created] = await res.json();
    return json({ ok: true, provider: { ...created, api_key_encrypted: maskKey(created.api_key_encrypted) } }, 201);
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }
}

export async function onRequestPut({ request, env, params }) {
  if (!(await validateAdminAccess(request, env))) {
    return json({ ok: false, message: "Unauthorized" }, 401);
  }

  const id = params?.id;
  if (!id) return json({ ok: false, message: "Thiếu provider ID" }, 400);

  let body;
  try {
    body = await readJson(request);
  } catch {
    return json({ ok: false, message: "Invalid JSON" }, 400);
  }

  const encKey = getEncryptionKey(env);
  const sanitized = sanitizeProviderBody(body);
  if (sanitized.error) return json({ ok: false, message: sanitized.error }, 400);

  const updates = { ...sanitized.value };
  delete updates.models; // chỉ ghi models khi có gửi
  if (body.models !== undefined) updates.models = sanitized.value.models;

  const apiKey = String(body.api_key || "").trim();
  if (apiKey) {
    if (!encKey) return json({ ok: false, message: "Server chưa cấu hình KIM_CONFIG_ENCRYPTION_KEY" }, 500);
    updates.api_key_encrypted = await encryptApiKey(apiKey, encKey);
  }

  if (Object.keys(updates).length === 0) {
    return json({ ok: false, message: "Không có field nào để cập nhật" }, 400);
  }

  try {
    const { url, key } = supabaseService(env);
    const res = await fetch(`${url}/rest/v1/kim_provider_config?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
        prefer: "return=representation"
      },
      body: JSON.stringify(updates)
    });

    if (!res.ok) throw new Error(`DB error ${res.status}`);
    const rows = await res.json();
    if (!rows.length) return json({ ok: false, message: "Provider not found" }, 404);

    return json({ ok: true, provider: { ...rows[0], api_key_encrypted: maskKey(rows[0].api_key_encrypted) } });
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }
}

export async function onRequestDelete({ request, env, params }) {
  if (!(await validateAdminAccess(request, env))) {
    return json({ ok: false, message: "Unauthorized" }, 401);
  }

  const id = params?.id;
  if (!id) return json({ ok: false, message: "Thiếu provider ID" }, 400);

  try {
    const { url, key } = supabaseService(env);
    const res = await fetch(`${url}/rest/v1/kim_provider_config?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { apikey: key, authorization: `Bearer ${key}` }
    });

    if (!res.ok) throw new Error(`DB error ${res.status}`);
    return json({ ok: true, deleted: id });
  } catch (e) {
    return json({ ok: false, message: e.message }, 500);
  }
}