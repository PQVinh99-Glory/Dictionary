import { validateSession } from "../../_lib/moris/v5/connectors/supabase.js";

const BROWSER_CACHE =
  "private, max-age=3600, stale-while-revalidate=86400";

const CDN_CACHE =
  "private, max-age=86400, stale-while-revalidate=604800";

function text(message, status=500) {
  return new Response(message, {
    status,
    headers:{
      "content-type":"text/plain; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff"
    }
  });
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function extractToken(request) {
  return (
    request.headers.get("x-session-token") ||
    (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") ||
    getCookie(request, "catalogue_session") ||
    new URL(request.url).searchParams.get("token") ||
    ""
  ).trim();
}

function getObjectKey(params) {
  const raw = params?.path;
  const parts = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  return parts
    .map(part => String(part))
    .filter(Boolean)
    .join("/")
    .replace(/^\/+/, "");
}

function applyMediaCacheHeaders(headers) {
  headers.set(
    "cache-control",
    headers.get("cache-control") || BROWSER_CACHE
  );
  headers.set("cdn-cache-control", CDN_CACHE);
  headers.set("x-content-type-options", "nosniff");
  headers.set("cross-origin-resource-policy", "same-origin");
  return headers;
}

export async function onRequestGet({ request, env, params }) {
  const token = extractToken(request);
  if (!token) return text("Unauthorized", 401);

  try {
    await validateSession(env, token);
  } catch (_) {
    return text("Unauthorized", 401);
  }

  if (!env.CATALOGUE_BUCKET) {
    return text("Missing R2 binding CATALOGUE_BUCKET.", 503);
  }

  const key = getObjectKey(params);
  if (!key) return text("Missing object key.", 400);

  let object;

  try {
    object = await env.CATALOGUE_BUCKET.get(key, {
      onlyIf: request.headers,
      range: request.headers
    });
  } catch (e) {
    console.error("R2 media get failed", {
      key,
      message:e?.message || String(e)
    });

    return text("R2 read failed.", 502);
  }

  if (object === null) {
    return text("Object not found.", 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);

  applyMediaCacheHeaders(headers);

  return new Response(
    "body" in object ? object.body : undefined,
    {
      status:"body" in object ? 200 : 412,
      headers
    }
  );
}

export async function onRequestHead({ request, env, params }) {
  const token = extractToken(request);
  if (!token) return new Response(null, { status: 401 });

  try {
    await validateSession(env, token);
  } catch (_) {
    return new Response(null, { status: 401 });
  }

  if (!env.CATALOGUE_BUCKET) {
    return new Response(null, {status:503});
  }

  const key = getObjectKey(params);
  if (!key) return new Response(null, {status:400});

  const object = await env.CATALOGUE_BUCKET.head(key);
  if (object === null) {
    return new Response(null, {status:404});
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);

  applyMediaCacheHeaders(headers);

  return new Response(null, {
    status:200,
    headers
  });
}
