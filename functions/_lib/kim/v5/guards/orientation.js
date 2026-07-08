export function orientationWarnings(queryText, candidates) {
  const q = String(queryText || "").toLowerCase();
  const requestsLeft = /\b(left|lhf|trai)\b/i.test(q);
  const requestsRight = /\b(right|rhf|phai)\b/i.test(q);

  const warnings = [];
  if (requestsLeft && requestsRight) {
    warnings.push("Query chứa đồng thời left và right; không suy luận bằng mirror.");
  }

  for (const row of candidates || []) {
    if (row?.is_symmetric === false && !row?.usage_side) {
      warnings.push(`Candidate ${row?.id ?? row?.record_id}: thiếu usage_side cho vật thể bất đối xứng.`);
    }
  }

  return [...new Set(warnings)].slice(0,10);
}
