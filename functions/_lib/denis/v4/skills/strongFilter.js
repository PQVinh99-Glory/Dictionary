export function strongDeterministicMatches(ranked, constraints) {
  const rows = Array.isArray(ranked) ? ranked : [];

  // Hole count is a strong explicit business constraint.
  if (Number.isFinite(constraints?.hole_count) && constraints.hole_count >= 0) {
    const holeTag = `${constraints.hole_count} holes`;
    const exactHole = rows.filter(x =>
      Array.isArray(x?.meta?.matched) &&
      x.meta.matched.includes(holeTag)
    );

    if (exactHole.length) {
      return {
        matched:true,
        reason:`Khớp deterministic số lỗ = ${constraints.hole_count}.`,
        rows:exactHole
      };
    }
  }

  // Color + other strong text constraints.
  if ((constraints?.colors || []).length && (constraints?.strong_constraint_count || 0) >= 2) {
    const colorMatches = rows.filter(x =>
      (constraints.colors || []).every(color =>
        (x?.meta?.matched || []).includes(`color:${color}`)
      )
    );

    if (colorMatches.length) {
      return {
        matched:true,
        reason:"Khớp deterministic màu + đặc điểm mạnh.",
        rows:colorMatches
      };
    }
  }

  return {matched:false, reason:"Không có strong deterministic match.", rows:[]};
}
