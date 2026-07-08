function baseUrl(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function anonKey(env) {
  return String(env.SUPABASE_ANON_KEY || "");
}

export async function rpc(env, fn, args) {
  const url = baseUrl(env);
  const key = anonKey(env);
  if (!url || !key) throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_ANON_KEY.");

  const res = await fetch(`${url}/rest/v1/rpc/${encodeURIComponent(fn)}`, {
    method:"POST",
    headers:{
      "content-type":"application/json",
      "apikey":key,
      "authorization":`Bearer ${key}`
    },
    body:JSON.stringify(args || {})
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message || `Supabase RPC ${fn} lỗi HTTP ${res.status}.`);
  }
  return data;
}

export async function validateSession(env, token) {
  if (!token) return {ok:false, status:401, message:"Thiếu session token."};
  const data = await rpc(env, "app_me", {p_session_token:token});
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    return {ok:false, status:401, message:row?.message || "Session không hợp lệ hoặc đã hết hạn."};
  }
  return {ok:true, user:row};
}

export async function searchCatalogue(env, token, {
  search="",
  usageSide="all",
  viewMode="all",
  limit=30,
  offset=0
}={}) {
  const data = await rpc(env, "app_search_catalogue", {
    p_session_token:token,
    p_search:String(search || ""),
    p_usage_side:usageSide || "all",
    p_view_mode:viewMode || "all",
    p_limit:limit,
    p_offset:offset
  });
  return Array.isArray(data) ? data : [];
}

export async function getPartAssets(env, token, imageId) {
  const data = await rpc(env, "app_get_part_assets", {
    p_session_token:token,
    p_image_id:imageId
  });
  return Array.isArray(data) ? data : [];
}

export async function scanCatalogue(env, token, {
  search="",
  usageSide="all",
  viewMode="all",
  maxRows=1500
}={}) {
  const pageSize = 100;
  const rows = [];
  for (let offset=0; offset<maxRows; offset+=pageSize) {
    const page = await searchCatalogue(env, token, {
      search, usageSide, viewMode, limit:pageSize, offset
    });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows.slice(0, maxRows);
}
