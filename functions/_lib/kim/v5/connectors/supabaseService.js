function baseUrl(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/,"");
}

function serviceKey(env) {
  return String(env.SUPABASE_SERVICE_ROLE_KEY || "");
}

export async function rpcService(env, fn, args) {
  const url = baseUrl(env);
  const key = serviceKey(env);

  if (!url || !key) {
    const e = new Error(
      "Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY."
    );
    e.status = 503;
    throw e;
  }

  const res = await fetch(
    `${url}/rest/v1/rpc/${encodeURIComponent(fn)}`,
    {
      method:"POST",
      headers:{
        "content-type":"application/json",
        "apikey":key,
        "authorization":`Bearer ${key}`
      },
      body:JSON.stringify(args || {})
    }
  );

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const e = new Error(
      data?.message ||
      `Supabase service RPC ${fn} HTTP ${res.status}`
    );
    e.status = res.status;
    e.details = data;
    throw e;
  }

  return data;
}
