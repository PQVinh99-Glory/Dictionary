import { stableHash } from "../../../shared/hash.js";

export async function finalizeCandidatePool(rows, {limit=10}={}) {
  const map = new Map();

  for (const row of rows || []) {
    const id = String(row?.id ?? row?.record_id ?? "");
    if (!id || map.has(id)) continue;
    map.set(id,row);
  }

  const candidates = [...map.values()]
    .sort((a,b) => Number(b.final_score || 0) - Number(a.final_score || 0))
    .slice(0,limit);

  const hash = await stableHash(
    candidates.map(x => ({
      id:String(x?.id ?? x?.record_id),
      score:Number(x?.final_score || 0)
    }))
  );

  return {candidates,hash};
}
