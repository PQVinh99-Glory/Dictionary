// Middleware cho /api/auth/* — origin allowlist + JSON + chống cache.
// Khác with moris middleware: API đăng nhập cần camera/none; KHÔNG đặt
// x-frame-options DENY tại đây vì JSON không bị embed, giữ nosniff + no-store.
function allowedOrigins(env, request) {
  const current = new URL(request.url).origin;
  const extra = String(env.MORIS_ALLOWED_ORIGINS || "")
    .split(",").map((x) => x.trim()).filter(Boolean);
  return new Set([current, ...extra, "http://localhost:5173", "http://127.0.0.1:5173"]);
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const method = request.method.toUpperCase();
  const origin = request.headers.get("origin");

  if (origin && !allowedOrigins(env, request).has(origin)) {
    return new Response(JSON.stringify({ ok: false, error: "Origin không được phép." }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const type = String(request.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("application/json")) {
      return new Response(JSON.stringify({ ok: false, error: "Content-Type phải là application/json." }), {
        status: 415,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }
  }

  const response = await next();
  const out = new Response(response.body, response);
  out.headers.set("content-type", "application/json; charset=utf-8");
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("referrer-policy", "same-origin");
  out.headers.set("cache-control", "no-store");
  return out;
}
