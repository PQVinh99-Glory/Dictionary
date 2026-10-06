export function enforceCandidatePool(resultRows, allowedRows, {limit=5}={}) {
  const allowed = new Set(
    (allowedRows || []).map(x => String(x?.id ?? x?.record_id ?? ""))
  );

  const out = [];
  const seen = new Set();

  for (const row of resultRows || []) {
    const id = String(row?.candidate_id ?? row?.id ?? "");
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
    if (out.length >= limit) break;
  }

  return out;
}
