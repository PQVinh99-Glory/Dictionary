import { asHttpError } from "./errors.js";

export function json(data, status=200, extraHeaders={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff",
      ...extraHeaders
    }
  });
}

export async function readJson(request, {maxBytes=4_500_000}={}) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) {
    const e = new Error(`Request quá lớn. Giới hạn ${maxBytes} bytes.`);
    e.status = 413;
    throw e;
  }

  const text = await request.text();
  if (!text) return {};

  if (text.length > maxBytes) {
    const e = new Error(`Request quá lớn. Giới hạn ${maxBytes} bytes.`);
    e.status = 413;
    throw e;
  }

  try {
    return JSON.parse(text);
  } catch {
    const e = new Error("JSON request không hợp lệ.");
    e.status = 400;
    throw e;
  }
}

export function errorResponse(error) {
  const e = asHttpError(error);
  return json({
    ok:false,
    error:e.message,
    details:e.details || undefined
  }, e.status);
}

export function corsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods":"GET,POST,OPTIONS",
    "access-control-allow-headers":"content-type,x-kim-admin-token",
    "vary":"Origin"
  };
}
