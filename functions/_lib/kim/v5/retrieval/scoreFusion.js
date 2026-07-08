function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v || 0)));
}

export function fuseCandidateScore(candidate, {hasMaskedVector=false}={}) {
  const vector = clamp01(candidate.vector_similarity);
  const masked = clamp01(candidate.masked_vector_similarity);
  const metadata = clamp01(candidate.metadata_score);
  const structural = clamp01(candidate.structural_score);

  const final = hasMaskedVector
    ? 0.65*vector + 0.10*masked + 0.15*metadata + 0.10*structural
    : 0.75*vector + 0.15*metadata + 0.10*structural;

  return {...candidate,final_score:clamp01(final)};
}
