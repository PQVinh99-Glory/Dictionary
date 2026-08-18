// API Rotator v2 — Cloudflare Workers/Pages compatible.
// Hỗ trợ 3 protocol:
//   - openai-completions  : POST {baseURL}/chat/completions (OpenAI-compatible chuẩn)
//   - openai-responses    : POST {baseURL}/responses (OpenAI Responses API)
//   - anthropic-messages  : POST {baseURL}/messages (Anthropic Messages API)
//
// Config ưu tiên: (1) env KIM_PROVIDERS → (2) Supabase kim_provider_config → (3) fallback env.
// API key mã hóa AES-256-GCM trong DB, giải mã tại edge.
// Auto-rotate khi 429/quota/lỗi mạng, cooldown per-model, streaming passthrough.
//
// Roles: "vision" | "orchestrator" | "synthesizer" | "fallback" | "lightweight"

const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_RETRIES = 3;
const DB_CACHE_TTL_MS = 5 * 60_000;

export const PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"];

// In-memory state (per-isolate, resets on cold start — acceptable for rotation)
const modelCooldowns = new Map();
let dbCache = null; // { providers, fetchedAt }

// ==================================================================
// Crypto: decrypt AES-256-GCM API key (Web Crypto API)
// ==================================================================

async function decryptApiKey(encryptedStr, encKeyHex) {
  if (!encryptedStr || !encryptedStr.includes(":")) return null;
  if (!encKeyHex || encKeyHex.length !== 64) return null;
  try {
    const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const encKeyBytes = Uint8Array.from(encKeyHex.match(/.{2}/g), (b) => parseInt(b, 16));
    const parts = encryptedStr.split(":");
    const iv = fromBase64(parts[0]);
    const ciphertextWithTag = fromBase64(parts[1]);
    const cryptoKey = await crypto.subtle.importKey("raw", encKeyBytes, "AES-GCM", false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertextWithTag);
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

// ==================================================================
// Provider resolution: env → DB → fallback
// ==================================================================

async function fetchProvidersFromDb(env) {
  if (dbCache && Date.now() - dbCache.fetchedAt < DB_CACHE_TTL_MS) {
    return dbCache.providers;
  }

  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;

  try {
    const res = await fetch(`${url}/rest/v1/kim_provider_config?is_active=eq.true&order=priority.asc`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const encKeyHex = String(env.KIM_CONFIG_ENCRYPTION_KEY || "").trim();
    const providers = [];

    for (const row of rows) {
      let apiKey = "";
      if (row.api_key_encrypted && row.api_key_encrypted !== "PLACEHOLDER_ENCRYPTED_KEY") {
        apiKey = await decryptApiKey(row.api_key_encrypted, encKeyHex);
      }
      if (!apiKey) continue;

      providers.push({
        providerId: row.provider_id || row.name,
        name: row.name,
        displayName: row.display_name || row.name,
        baseURL: row.base_url,
        protocol: PROTOCOLS.includes(row.api_protocol) ? row.api_protocol : "openai-completions",
        apiKey, // plaintext in-memory only
        models: Array.isArray(row.models) ? row.models : [],
        priority: row.priority || 0,
      });
    }

    if (providers.length > 0) {
      dbCache = { providers, fetchedAt: Date.now() };
      return providers;
    }
    return null;
  } catch {
    return null;
  }
}

function parseProvidersFromEnv(env) {
  const raw = String(env.KIM_PROVIDERS || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((p) => ({
      providerId: p.providerId || p.provider_id || p.name,
      name: p.name,
      displayName: p.displayName || p.display_name || p.name,
      baseURL: p.baseURL || p.base_url,
      protocol: PROTOCOLS.includes(p.protocol || p.api_protocol) ? (p.protocol || p.api_protocol) : "openai-completions",
      apiKey: p.apiKey || String(env[p.apiKeyEnv] || env.XKIRO_API_KEY || "").trim(),
      models: p.models || [],
      priority: p.priority || 0,
    }));
  } catch {
    return null;
  }
}

function buildFallbackProvider(env) {
  const baseURL = String(env.KIM_LLM_BASE_URL || "https://api.xkiro.com/v1");
  const apiKey = String(env.KIM_LLM_API_KEY || env.XKIRO_API_KEY || "").trim();
  const defaultModel = String(env.KIM_LLM_MODEL || "qwen/qwen3.8-max");
  return [
    {
      providerId: "default",
      name: "default",
      displayName: "Default Provider",
      baseURL,
      protocol: "openai-completions",
      apiKey,
      models: [{ id: defaultModel, roles: ["orchestrator", "vision", "synthesizer", "fallback"] }],
      priority: 0,
    },
  ];
}

/**
 * Resolve providers: env → Supabase DB → fallback.
 */
export async function resolveProviders(env) {
  const envProviders = parseProvidersFromEnv(env);
  if (envProviders && envProviders.length > 0) return envProviders;

  const dbProviders = await fetchProvidersFromDb(env);
  if (dbProviders && dbProviders.length > 0) return dbProviders;

  return buildFallbackProvider(env);
}

// ==================================================================
// Cooldown management
// ==================================================================

function isCooledDown(providerName, modelId) {
  const key = `${providerName}/${modelId}`;
  const until = modelCooldowns.get(key);
  return until ? Date.now() < until : false;
}

function setCooldown(providerName, modelId, retryAfterMs) {
  const key = `${providerName}/${modelId}`;
  const ms = Math.max(retryAfterMs || DEFAULT_COOLDOWN_MS, 5000);
  modelCooldowns.set(key, Date.now() + ms);
}

// ==================================================================
// Candidate selection
// ==================================================================

/**
 * Select candidate models for a given role, sorted by priority and cooldown.
 */
export function selectCandidates(providers, role) {
  const candidates = [];
  for (const provider of providers) {
    for (const model of provider.models || []) {
      const roles = model.roles || ["fallback"];
      if (roles.includes(role) || roles.includes("fallback")) {
        candidates.push({
          provider,
          model,
          isPrimary: roles.includes(role),
          cooledDown: isCooledDown(provider.name, model.id),
        });
      }
    }
  }
  candidates.sort((a, b) => {
    if (a.cooledDown !== b.cooledDown) return a.cooledDown ? 1 : -1;
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return (a.provider.priority || 0) - (b.provider.priority || 0);
  });
  return candidates;
}

// ==================================================================
// Protocol adapters: build request per protocol
// ==================================================================

/**
 * Convert internal messages [{role, content}] to protocol-specific format.
 * @param {string} protocol
 * @param {object} body - { model, messages, temperature, max_tokens, response_format?, stream? }
 * @returns {{ url, headers, body }} protocol-specific fetch params
 */
function buildProtocolRequest(provider, body, stream) {
  const base = provider.baseURL.replace(/\/+$/, "");

  switch (provider.protocol) {
    // ── OpenAI Chat Completions (chuẩn) ─────────────────────────────
    case "openai-completions": {
      const url = `${base}/chat/completions`;
      const requestBody = { ...body };
      if (stream) requestBody.stream = true;
      return {
        url,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      };
    }

    // ── OpenAI Responses API ────────────────────────────────────────
    case "openai-responses": {
      const url = `${base}/responses`;
      // Responses API dùng "input" thay vì "messages"
      const { messages, ...rest } = body;
      const requestBody = {
        ...rest,
        input: messages,
        max_output_tokens: rest.max_tokens || 4096,
      };
      delete requestBody.max_tokens;
      if (stream) requestBody.stream = true;
      return {
        url,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      };
    }

    // ── Anthropic Messages API ──────────────────────────────────────
    case "anthropic-messages": {
      const url = `${base}/messages`;
      const { messages, ...rest } = body;

      // Anthropic tách system ra khỏi messages
      const systemParts = messages.filter((m) => m.role === "system");
      const nonSystem = messages.filter((m) => m.role !== "system");
      const system = systemParts.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n\n");

      // Convert content: Anthropic cần format content blocks cho images
      const convertedMessages = nonSystem.map((m) => {
        if (typeof m.content === "string") return m;
        // Array content (vision): convert image_url → base64 source
        if (Array.isArray(m.content)) {
          return {
            role: m.role,
            content: m.content.map((block) => {
              if (block.type === "image_url" && block.image_url?.url?.startsWith("data:")) {
                const match = /^data:([^;]+);base64,(.+)$/s.exec(block.image_url.url);
                if (match) {
                  return {
                    type: "image",
                    source: { type: "base64", media_type: match[1], data: match[2] },
                  };
                }
              }
              if (block.type === "text") return { type: "text", text: block.text || "" };
              return { type: "text", text: JSON.stringify(block) };
            }),
          };
        }
        return m;
      });

      const requestBody = {
        model: rest.model,
        max_tokens: rest.max_tokens || 4096,
        temperature: rest.temperature ?? 0.1,
        messages: convertedMessages,
      };
      if (system) requestBody.system = system;
      if (stream) requestBody.stream = true;

      return {
        url,
        headers: {
          "content-type": "application/json",
          "x-api-key": provider.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(requestBody),
      };
    }

    default:
      throw new Error(`Protocol không hỗ trợ: ${provider.protocol}`);
  }
}

/**
 * Extract text content from protocol-specific response.
 */
function extractContent(protocol, data) {
  switch (protocol) {
    case "openai-completions":
      return data?.choices?.[0]?.message?.content || "";
    case "openai-responses":
      return data?.output_text || data?.output?.[0]?.content?.[0]?.text || "";
    case "anthropic-messages": {
      const block = data?.content?.find((b) => b.type === "text");
      return block?.text || "";
    }
    default:
      return "";
  }
}

// ==================================================================
// Core: call with rotation
// ==================================================================

/**
 * Call LLM with automatic rotation across providers/models.
 * @param {object} env - Cloudflare env bindings
 * @param {string} role - "vision" | "orchestrator" | "synthesizer" | "fallback" | "lightweight"
 * @param {object} body - Internal format: { model?, messages, temperature?, max_tokens? }
 * @param {object} options - { stream, signal, maxRetries }
 * @returns {{ data?, stream?, content?, modelUsed, providerUsed, protocol }}
 */
export async function callWithRotation(env, role, body, options = {}) {
  const { stream = false, signal, maxRetries = MAX_RETRIES } = options;
  const providers = await resolveProviders(env);
  const candidates = selectCandidates(providers, role);

  if (candidates.length === 0) {
    throw Object.assign(new Error(`Không có model nào cho role "${role}".`), { code: "KIM_NO_MODEL_AVAILABLE" });
  }

  let lastError = null;
  let attempts = 0;

  for (const candidate of candidates) {
    if (attempts >= maxRetries) break;
    attempts++;

    const { provider, model } = candidate;
    if (!provider.apiKey) {
      lastError = new Error(`Missing API key for ${provider.displayName}`);
      continue;
    }

    try {
      const req = buildProtocolRequest(provider, { ...body, model: model.id }, stream);

      const res = await fetch(req.url, {
        method: "POST",
        signal,
        headers: req.headers,
        body: req.body,
      });

      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        const retryMs = retryAfter ? Number(retryAfter) * 1000 : DEFAULT_COOLDOWN_MS;
        setCooldown(provider.name, model.id, retryMs);
        lastError = Object.assign(new Error(`Rate limited: ${provider.displayName}/${model.id}`), { code: "KIM_RATE_LIMITED" });
        continue;
      }

      if (res.status === 402 || res.status === 403) {
        setCooldown(provider.name, model.id, 300_000);
        lastError = Object.assign(new Error(`Quota/auth error: ${provider.displayName}/${model.id} HTTP ${res.status}`), { code: "KIM_QUOTA_EXHAUSTED" });
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        lastError = Object.assign(new Error(`${provider.displayName}/${model.id} HTTP ${res.status}: ${errText.slice(0, 200)}`), { code: "KIM_API_ERROR" });
        continue;
      }

      if (stream) {
        return {
          stream: res.body,
          modelUsed: model.id,
          providerUsed: provider.displayName,
          protocol: provider.protocol,
          contentType: res.headers.get("content-type"),
        };
      }

      const data = await res.json();
      const content = extractContent(provider.protocol, data);
      return { data, content, modelUsed: model.id, providerUsed: provider.displayName, protocol: provider.protocol };
    } catch (e) {
      if (e.name === "AbortError") throw e;
      lastError = e;
      setCooldown(provider.name, model.id, DEFAULT_COOLDOWN_MS);
      continue;
    }
  }

  throw Object.assign(
    new Error(`Tất cả ${attempts} model cho role "${role}" thất bại. Lỗi cuối: ${lastError?.message || "unknown"}`),
    { code: lastError?.code || "KIM_ALL_MODELS_FAILED", cause: lastError }
  );
}

// ==================================================================
// Convenience: call and parse JSON
// ==================================================================

/**
 * Call LLM and parse JSON response.
 * @param {object} env
 * @param {string} role
 * @param {Array} messages - [{role, content}]
 * @param {object} options - { temperature, maxTokens, responseFormat, signal }
 */
export async function callJson(env, role, messages, options = {}) {
  const { temperature = 0.1, maxTokens = 4096, responseFormat, signal } = options;
  const body = { messages, temperature, max_tokens: maxTokens };
  if (responseFormat) body.response_format = responseFormat;

  const result = await callWithRotation(env, role, body, { stream: false, signal });
  const content = result.content || "";

  let parsed = null;
  if (responseFormat?.type === "json_object" || content.trim().startsWith("{") || content.trim().startsWith("[")) {
    try {
      parsed = JSON.parse(content);
    } catch {
      // Not valid JSON — return raw
    }
  }

  return { content, json: parsed, modelUsed: result.modelUsed, providerUsed: result.providerUsed, protocol: result.protocol };
}

// ==================================================================
// Status: debug rotation state
// ==================================================================

/**
 * Get current rotation status for debugging.
 */
export async function getRotatorStatus(env) {
  const providers = await resolveProviders(env);
  const status = [];
  for (const provider of providers) {
    for (const model of provider.models || []) {
      const key = `${provider.name}/${model.id}`;
      const until = modelCooldowns.get(key);
      status.push({
        provider: provider.displayName,
        providerId: provider.providerId,
        protocol: provider.protocol,
        model: model.id,
        roles: model.roles || ["fallback"],
        cooledDown: until ? Date.now() < until : false,
        cooldownRemainingMs: until ? Math.max(0, until - Date.now()) : 0,
      });
    }
  }
  return status;
}