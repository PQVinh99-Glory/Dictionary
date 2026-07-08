function baseUrl(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/,"");
}

function key(env) {
  return String(env.SUPABASE_ANON_KEY || "");
}

export async function rpc(env, fn, args) {
  const url = baseUrl(env);
  const anon = key(env);

  if (!url || !anon) {
    throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_ANON_KEY.");
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

export async function retrieveByQueries(env, token, queries, {limitPerQuery=50}={}) {
  const uniqueQueries = [...new Set(
    (queries || []).map(x => String(x || "").trim()).filter(Boolean)
  )].slice(0,6);

  const resultSets = await Promise.all(
    (uniqueQueries.length ? uniqueQueries : [""]).map(q =>
      searchCatalogue(env, token, {
        search:q,
        usageSide:"all",
        viewMode:"all",
        limit:limitPerQuery,
        offset:0
      }).catch(() => [])
    )
  );

  const map = new Map();
  for (const row of resultSets.flat()) {
    const id = String(row?.id ?? `${row?.code}|${row?.part_id}`);
    if (!map.has(id)) map.set(id,row);
  }

  return [...map.values()];
}
