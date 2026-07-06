const HEADERS = {
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff"
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {status, headers:HEADERS});
}

export async function onRequestGet({ env }) {
  if (!env.CATALOGUE_BUCKET) {
    return json({
      ok:false,
      provider:"pages-r2",
      status:"missing_binding",
      message:"Thiếu R2 binding CATALOGUE_BUCKET."
    }, 503);
  }

  try {
    await env.CATALOGUE_BUCKET.list({ limit:1 });
    return json({ ok:true, provider:"pages-r2", status:"healthy" });
  } catch (e) {
    console.error("R2 health failed", e?.message || String(e));
    return json({
      ok:false,
      provider:"pages-r2",
      status:"r2_unreachable",
      message:"Binding tồn tại nhưng không truy cập được R2."
    }, 503);
  }
}
