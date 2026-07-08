function baseUrl(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/," ").trim();
}

function serverKey(env) {
  return String(
    env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();
}

function headersForKey(key){
  const headers={
    "content-type":"application/json",
    "apikey":key
  };
  // Legacy service_role is JWT. New sb_secret_* is not a Bearer JWT.
  if(!key.startsWith("sb_secret_")){
    headers.authorization=`Bearer ${key}`;
  }
  return headers;
}

export async function rpcService(env, fn, args) {
  const url = baseUrl(env);
  const key = serverKey(env);

  if (!url || !key) {
    const e = new Error(
      "Thiếu SUPABASE_URL hoặc server secret key."
    );
    e.status = 503;
    throw e;
  }

  const res = await fetch(
    `${url}/rest/v1/rpc/${encodeURIComponent(fn)}`,
    {
      method:"POST",
      headers:headersForKey(key),
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
