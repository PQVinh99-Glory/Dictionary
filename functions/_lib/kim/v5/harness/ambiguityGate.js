export function shouldCallGemini({
  candidates,
  queryQuality=1,
  structuralConflicts=0,
  angleRisk=0,
  lightingRisk=0,
  ambiguityGap=0.035
}) {
  const rows = [...(candidates || [])]
    .sort((a,b) => Number(b.final_score || 0) - Number(a.final_score || 0));

  if (rows.length < 2) return false;

  const gap =
    Number(rows[0].final_score || 0) -
    Number(rows[1].final_score || 0);

  return (
    gap < ambiguityGap ||
    queryQuality < 0.65 ||
    structuralConflicts > 0 ||
    angleRisk > 0.6 ||
    lightingRisk > 0.6
  );
}

export function shouldCallGemma({
  geminiResult,
  judgeGap=0.05,
  orientationConflict=false,
  holeConflict=false
}) {
  const rows = [...(geminiResult?.rankings || [])]
    .sort((a,b) => Number(b.score || 0) - Number(a.score || 0));

  const gap = rows.length >= 2
    ? Number(rows[0].score || 0) - Number(rows[1].score || 0)
    : 1;

  return (
    geminiResult?.ambiguous === true ||
    gap < judgeGap ||
    orientationConflict ||
    holeConflict
  );
}
