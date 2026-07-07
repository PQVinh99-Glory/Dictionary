export function preferredImagePath(row) {
  return row?.front_path || row?.thumb_path || row?.fallback_path || "";
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;

  for (let i=0;i<bytes.length;i+=chunk) {
    binary += String.fromCharCode(...bytes.subarray(i,i+chunk));
  }

  return btoa(binary);
}

export async function r2ImageDataUrl(env, path, {maxBytes=1_200_000}={}) {
  if (!env.CATALOGUE_BUCKET || !path) return null;

  const key = String(path).replace(/^\/+/,"");
  const object = await env.CATALOGUE_BUCKET.get(key);

  if (!object) return null;
  if (Number(object.size || 0) > maxBytes) return null;

  const buffer = await new Response(object.body).arrayBuffer();
  const mimeType = object.httpMetadata?.contentType || "image/webp";

  return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
}
