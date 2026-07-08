export function collapseBestVectorHitPerRecord(hits, {limit=100}={}) {
  const best = new Map();

  for (const hit of hits || []) {
    const recordId = String(hit?.record_id || "");
    if (!recordId) continue;

    const similarity = Number(hit?.similarity || 0);
    const current = best.get(recordId);

    if (
      !current ||
      similarity > Number(current?.similarity || 0)
    ) {
      best.set(recordId,{
        ...hit,
        record_id:recordId,
        similarity
      });
    }
  }

  return [...best.values()]
    .sort(
      (a,b) =>
        Number(b?.similarity || 0) -
        Number(a?.similarity || 0)
    )
    .slice(0,Math.max(1,Number(limit || 100)));
}
