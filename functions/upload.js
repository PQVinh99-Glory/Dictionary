const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

const ALLOWED_ASSET_TYPES = new Set(["thumb", "front", "back", "detail", "compare"]);
const ALLOWED_MIME_TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function cleanBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function safeCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return code || "UNKNOWN";
}

function safeUploadId(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "")
    .slice(0, 100);
}

function extensionForMime(mime) {
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return "bin";
}

async function validateAppSession(env, token) {
  if (!token) return { ok:false, status:401, message:"Thiếu x-session-token." };

  const supabaseUrl = cleanBaseUrl(env.SUPABASE_URL);
  const anonKey = String(env.SUPABASE_ANON_KEY || "");

  if (!supabaseUrl || !anonKey) {
    return {
      ok:false,
      status:503,
      message:"Pages Function chưa cấu hình SUPABASE_URL/SUPABASE_ANON_KEY."
    };
  }

  let res;
  try {
    res = await fetch(`${supabaseUrl}/rest/v1/rpc/app_me`, {
      method:"POST",
      headers:{
        "content-type":"application/json",
        "apikey":anonKey,
        "authorization":`Bearer ${anonKey}`
      },
      body:JSON.stringify({ p_session_token:token })
    });
  } catch (_) {
    return { ok:false, status:502, message:"Không kết nối được Supabase để xác thực session." };
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok:false,
      status:502,
      message:data?.message || `Supabase app_me lỗi HTTP ${res.status}.`
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    return { ok:false, status:401, message:row?.message || "Session không hợp lệ hoặc đã hết hạn." };
  }

  if (!["admin", "editor"].includes(row.role_name)) {
    return { ok:false, status:403, message:"Tài khoản không có quyền upload." };
  }

  return { ok:true, user:row };
}

export async function onRequestOptions() {
  return new Response(null, {
    status:204,
    headers:{ "allow":"POST, OPTIONS", "cache-control":"no-store" }
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.CATALOGUE_BUCKET) {
    return json({ ok:false, message:"Thiếu R2 binding CATALOGUE_BUCKET." }, 503);
  }

  const sessionToken = request.headers.get("x-session-token") || "";
  const auth = await validateAppSession(env, sessionToken);
  if (!auth.ok) return json({ ok:false, message:auth.message }, auth.status);

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ ok:false, message:"Body phải là multipart/form-data." }, 400);
  }

  const file = form.get("file");
  const codeRaw = form.get("code");
  const assetType = String(form.get("asset_type") || "").trim().toLowerCase();
  const requestedUploadId =
    form.get("upload_id")
    || request.headers.get("x-upload-id")
    || "";

  if (!file || typeof file.stream !== "function") {
    return json({ ok:false, message:"Thiếu file ảnh hợp lệ." }, 400);
  }

  if (!ALLOWED_ASSET_TYPES.has(assetType)) {
    return json({ ok:false, message:`asset_type không hợp lệ: ${assetType || "(trống)"}` }, 400);
  }

  const mime = String(file.type || "").toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return json({ ok:false, message:`Định dạng ảnh không được phép: ${mime || "(không rõ)"}` }, 415);
  }

  const size = Number(file.size || 0);
  if (!size || size > MAX_UPLOAD_BYTES) {
    return json({
      ok:false,
      message:`Kích thước ảnh phải > 0 và <= ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`
    }, 413);
  }

  const code = safeCode(codeRaw);
  const uploadId = safeUploadId(requestedUploadId) || crypto.randomUUID();
  const ext = extensionForMime(mime);
  const key = `${assetType}/${code}/${uploadId}.${ext}`;

  try {
    await env.CATALOGUE_BUCKET.put(key, file.stream(), {
      httpMetadata:{
        contentType:mime,
        cacheControl:"public, max-age=31536000, immutable"
      },
      customMetadata:{
        code,
        asset_type:assetType,
        uploaded_by:String(auth.user?.username || auth.user?.display_name || "unknown").slice(0, 120)
      }
    });
  } catch (e) {
    console.error("R2 put failed", { key, message:e?.message || String(e) });
    return json({ ok:false, message:"Không ghi được ảnh vào R2." }, 502);
  }

  return json({
    ok:true,
    provider:"pages-r2",
    asset_type:assetType,
    image_path:key,
    image_name:String(file.name || `${code}.${ext}`).slice(0, 240),
    upload_id:uploadId
  });
}
