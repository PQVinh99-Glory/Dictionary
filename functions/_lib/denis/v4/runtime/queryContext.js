async function sha256(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2,"0"))
    .join("");
}

export async function createQueryContext({queryId, message="", imageDataUrl=null}) {
  const safeId = /^[A-Za-z0-9_-]{8,128}$/.test(String(queryId || ""))
    ? String(queryId)
    : crypto.randomUUID();

  const imageHash = imageDataUrl
    ? await sha256(imageDataUrl)
    : null;

  return {
    query_id:safeId,
    image_hash:imageHash,
    message:String(message || ""),
    has_image:!!imageDataUrl,
    started_at:Date.now(),
    ai_calls:{total:0,gemini:0,openrouter:0},
    agents_run:[],
    events:[]
  };
}

export async function hashCandidatePool(rows) {
  const ids = (rows || []).map(r => String(r.id)).sort().join("|");
  return await sha256(ids);
}

export function trace(ctx, event, data={}) {
  ctx.events.push({
    at_ms:Date.now() - ctx.started_at,
    event,
    data
  });
}

export function publicTrace(ctx) {
  return {
    query_id:ctx.query_id,
    image_hash:ctx.image_hash,
    ai_calls:ctx.ai_calls,
    agents_run:ctx.agents_run,
    duration_ms:Date.now() - ctx.started_at,
    events:ctx.events
  };
}
