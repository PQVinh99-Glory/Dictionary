function norm(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .trim();
}

function holeCountFromText(text) {
  const m = norm(text).match(/(\d+)\s*(?:lo|hole|holes)\b/i);
  return m ? Number(m[1]) : null;
}

export function scoreMetadata(row, message) {
  const q = norm(message);
  if (!q) return 0;

  const hay = norm([
    row?.code,
    row?.part_id,
    row?.identifying_features,
    row?.confusing_note,
    row?.usage_side,
    row?.view_mode
  ].filter(Boolean).join(" "));

  const terms = [...new Set(q.split(/\s+/).filter(x => x.length >= 2))];
  const matched = terms.filter(t => hay.includes(t)).length;
  const lexical = terms.length ? matched / terms.length : 0;

  const holes = holeCountFromText(q);
  const holeBonus = holes != null && (
    hay.includes(`${holes} lo`) ||
    hay.includes(`${holes} hole`)
  ) ? 1 : 0;

  return Math.max(0, Math.min(1, 0.75 * lexical + 0.25 * holeBonus));
}

export function rankMetadata(rows, message) {
  return (rows || [])
    .map(row => ({...row,metadata_score:scoreMetadata(row,message)}))
    .sort((a,b) => b.metadata_score - a.metadata_score);
}

export function strongTextResult(rows, message) {
  const ranked = rankMetadata(rows, message);
  const strong = ranked.filter(x => x.metadata_score >= 0.72);

  return {
    sufficient:strong.length > 0 && strong.length <= 5,
    rows:strong.length ? strong : ranked.slice(0,5)
  };
}
