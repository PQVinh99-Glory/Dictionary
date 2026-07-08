function baseUrl(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/,"");
}

function anonKey(env) {
  return String(env.SUPABASE_ANON_KEY || "");
}

export async function rpc(env, fn, args) {
  const url = baseUrl(env);
  const anon = anonKey(env);

  if (!url || !anon) {
    const e = new Error("Thiếu SUPABASE_URL hoặc SUPABASE_ANON_KEY.");
    e.status = 503;
    throw e;
  }

  const res = await fetch(`${url}/rest/v1/rpc/${encodeURIComponent(fn)}`, {
    method:"POST",
    headers:{
      "content-type":"application/json",
      "apikey":anon,
      "authorization":`Bearer ${anon}`
    },
    body:JSON.stringify(args || {})
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const e = new Error(data?.message || `Supabase RPC ${fn} HTTP ${res.status}`);
    e.status = res.status;
    e.details = data;
    throw e;
  }

  return data;
}

export async function validateSession(env, token) {
  if (!token) {
    const e = new Error("Thiếu session token.");
    e.status = 401;
    throw e;
  }

  const data = await rpc(env, "app_me", {p_session_token:token});
  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.ok) {
    const e = new Error(row?.message || "Session không hợp lệ hoặc đã hết hạn.");
    e.status = 401;
    throw e;
  }

  return row;
}

export async function searchCatalogue(env, token, {
  search="",
  usageSide="all",
  viewMode="all",
  limit=50,
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

export async function scanCatalogue(env, token, {maxRows=1500}={}) {
  const rows = [];
  const pageSize = 100;

  for (let offset=0; offset<maxRows; offset+=pageSize) {
    const page = await searchCatalogue(env, token, {
      search:"",
      usageSide:"all",
      viewMode:"all",
      limit:pageSize,
      offset
    });

    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows.slice(0,maxRows);
}
