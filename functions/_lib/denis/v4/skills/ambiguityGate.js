export function gateBeforeVision({hasImage, constraints, ranked}) {
  const positive = (ranked || []).filter(x => x.meta.score > 0);
  const count = positive.length;
  const top = positive[0]?.meta?.score ?? 0;
  const second = positive[1]?.meta?.score ?? 0;
  const gap = top - second;

  if (!hasImage && count > 0 && count <= 5) {
    return {mode:"easy_filter", reason:"Text filter trả <= 5 ứng viên."};
  }

  if (hasImage &&
      constraints.strong_constraint_count >= 2 &&
      count > 0 &&
      count <= 5 &&
      gap >= 10) {
    return {mode:"easy_filter", reason:"Đặc điểm text đủ mạnh, không cần gọi Vision."};
  }

  return {mode:"needs_analysis", reason:"Candidate pool còn mơ hồ hoặc image query thiếu constraint mạnh."};
}

export function gateAfterSignature({ranked}) {
  const positive = (ranked || []).filter(x => x.meta.score > 0);
  const count = positive.length;
  const top = positive[0]?.meta?.score ?? 0;
  const second = positive[1]?.meta?.score ?? 0;
  const gap = top - second;

  if (count > 0 && count <= 5 && gap >= 12) {
    return {mode:"signature_sufficient", reason:"Visual signature + metadata đã thu hẹp đủ."};
  }

  return {mode:"needs_resolver", reason:"Cần so sánh trực tiếp query image với candidate images."};
}

export function isResolverAmbiguous(ranking, threshold=0.08) {
  const rows = [...(ranking?.rankings || [])].sort((a,b)=>b.score-a.score);

  if (ranking?.ambiguous) return true;
  if (rows.length < 2) return false;

  const gap = Number(rows[0].score || 0) - Number(rows[1].score || 0);
  const topConflicts = (rows[0].conflicts || []).length;

  return gap < threshold || topConflicts >= 2 || Number(rows[0].score || 0) < 0.65;
}
