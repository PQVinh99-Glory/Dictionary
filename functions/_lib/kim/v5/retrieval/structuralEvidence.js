function norm(v) {
  return String(v ?? "").toLowerCase();
}

function holeCount(text) {
  const m = norm(text).match(/(\d+)\s*(?:lỗ|lo|hole|holes)/i);
  return m ? Number(m[1]) : null;
}

export function analyzeStructuralEvidence({query,candidates}) {
  const requestedHoles = holeCount(query?.message || "");
  const byId = {};
  let conflicts = 0;

  for (const row of candidates || []) {
    const text = [
      row?.identifying_features,
      row?.confusing_note,
      row?.code,
      row?.part_id
    ].filter(Boolean).join(" ");

    const candidateHoles = holeCount(text);
    let score = 0.5;

    if (requestedHoles != null && candidateHoles != null) {
      if (requestedHoles === candidateHoles) score = 1;
      else {
        score = 0;
        conflicts += 1;
      }
    }

    byId[String(row?.id ?? row?.record_id)] = {
      score,
      requested_holes:requestedHoles,
      candidate_holes:candidateHoles
    };
  }

  return {
    byId,
    conflicts,
    angleRisk:query?.hints?.angle_risk || 0,
    lightingRisk:query?.hints?.lighting_risk || 0,
    orientationConflict:false,
    holeConflict:conflicts > 0
  };
}
