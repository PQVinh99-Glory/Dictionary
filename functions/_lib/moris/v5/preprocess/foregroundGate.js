export function foregroundDecision({
  backgroundComplexity=0,
  subjectCoverage=1,
  maskConfidence=0
}={}) {
  if (subjectCoverage < 0.05) {
    return {action:"fallback_original",reason:"subject_too_small"};
  }

  if (backgroundComplexity < 0.35) {
    return {action:"skip_removal",reason:"background_simple"};
  }

  if (maskConfidence >= 0.70) {
    return {action:"use_mask",reason:"mask_confident"};
  }

  return {action:"fallback_original",reason:"mask_uncertain"};
}
