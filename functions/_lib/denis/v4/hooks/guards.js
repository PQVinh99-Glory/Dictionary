export function assertCandidateIdsInsidePool(candidateIds, poolRows) {
  const pool = new Set((poolRows || []).map(r => String(r.id)));
  const invalid = (candidateIds || []).map(String).filter(id => !pool.has(id));

  if (invalid.length) {
    const e = new Error(`Model trả candidate ngoài pool: ${invalid.join(", ")}`);
    e.status = 422;
    throw e;
  }
}

export function validateRanking(output, poolRows) {
  const rankings = Array.isArray(output?.rankings) ? output.rankings : [];
  const ids = rankings.map(r => String(r.candidate_id));

  assertCandidateIdsInsidePool(ids,poolRows);

  const seen = new Set();
  const dup = ids.filter(id => seen.has(id) ? true : (seen.add(id), false));

  if (dup.length) {
    const e = new Error(`Model trả candidate trùng: ${dup.join(", ")}`);
    e.status = 422;
    throw e;
  }

  return true;
}

export function validateJudge(output, poolRows) {
  const ids = (output?.top5 || []).map(x => String(x.candidate_id));
  assertCandidateIdsInsidePool(ids,poolRows);
  return true;
}

export function assertTop5ForUi({queryId,candidates}) {
  if (!queryId) throw new Error("Thiếu query_id.");
  if (!Array.isArray(candidates)) throw new Error("Top5 candidates không phải array.");
  if (candidates.length > 5) throw new Error("Top5 vượt quá 5 candidate.");

  for (const c of candidates) {
    if (!c?.id || !c?.code) {
      throw new Error("Candidate thiếu id/code trước khi apply UI.");
    }
  }

  return true;
}
