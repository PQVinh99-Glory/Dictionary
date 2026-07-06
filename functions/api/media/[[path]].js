const DEFAULT_CACHE = "public, max-age=3600, stale-while-revalidate=86400";

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

function getObjectKey(params) {
  const raw = params?.path;
  const parts = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  return parts
    .map(part => String(part))
    .filter(Boolean)
    .join("/")
    .replace(/^\/+/, "");
}

export async function onRequestGet({ request, env, params }) {
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

  if (object === null) return text("Object not found.", 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", headers.get("cache-control") || DEFAULT_CACHE);
  headers.set("x-content-type-options", "nosniff");
  headers.set("cross-origin-resource-policy", "same-origin");

  return new Response("body" in object ? object.body : undefined, {
    status:"body" in object ? 200 : 412,
    headers
  });
}

export async function onRequestHead({ request, env, params }) {
  if (!env.CATALOGUE_BUCKET) {
    return new Response(null, {status:503});
  }

  const key = getObjectKey(params);
  if (!key) return new Response(null, {status:400});

  const object = await env.CATALOGUE_BUCKET.head(key);
  if (object === null) return new Response(null, {status:404});

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", headers.get("cache-control") || DEFAULT_CACHE);
  headers.set("x-content-type-options", "nosniff");

  return new Response(null, {status:200, headers});
}
