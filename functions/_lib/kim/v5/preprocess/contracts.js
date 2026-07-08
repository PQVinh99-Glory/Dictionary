export const PREPROCESS_CONTRACT = {
  version:"kim_fg_v1",
  longEdgeMax:1280,
  canonicalSize:224,
  paddingRatio:0.10,
  backgroundGate:true,
  foregroundRequired:false
};

export function foregroundDecision({
  backgroundComplexity,
  subjectCoverage,
  maskConfidence
}) {
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
