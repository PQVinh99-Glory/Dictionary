export function activeVectorProfile(config) {
  return {
    model:config.vector.model,
    model_version:config.vector.modelVersion,
    preprocess_version:config.vector.preprocessVersion,
    profile:config.vector.profile,
    dimension:config.vector.dimension
  };
}

export function sameVectorProfile(a, b) {
  return (
    String(a?.model) === String(b?.model) &&
    String(a?.model_version) === String(b?.model_version) &&
    String(a?.preprocess_version) === String(b?.preprocess_version) &&
    String(a?.profile) === String(b?.profile) &&
    Number(a?.dimension) === Number(b?.dimension)
  );
}
