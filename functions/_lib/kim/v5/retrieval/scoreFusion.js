function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v || 0)));
}

function addSignal(signals,score,weight,available=true){
  if(!available || score == null || !Number.isFinite(Number(score))) return;
  signals.push({score:clamp01(score),weight:Number(weight)});
}

export function fuseCandidateScore(candidate) {
  const signals=[];

  // Image retrieval is the primary evidence for image queries.
  addSignal(signals,candidate.vector_similarity,0.78,true);
  addSignal(
    signals,
    candidate.probe_consensus,
    0.08,
    Number.isFinite(Number(candidate.probe_consensus))
  );
  addSignal(
    signals,
    candidate.metadata_score,
    0.10,
    candidate.metadata_available === true
  );
  addSignal(
    signals,
    candidate.structural_score,
    0.12,
    candidate.structural_available === true
  );

  const totalWeight=signals.reduce((s,x)=>s+x.weight,0) || 1;
  let final=signals.reduce((s,x)=>s+x.score*x.weight,0)/totalWeight;

  const conflictCount=Array.isArray(candidate.conflicts)
    ? candidate.conflicts.length
    : 0;
  final -= Math.min(.24, conflictCount*.08);

  return {
    ...candidate,
    final_score:clamp01(final),
    match_score:clamp01(final),
    score_source:'evidence_aware_fusion'
  };
}
