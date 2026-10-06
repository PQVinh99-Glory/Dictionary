export function estimateQueryQuality({
  width=0,
  height=0,
  blurScore=0.5,
  exposureScore=0.5,
  subjectCoverage=0.5
}={}) {
  const resolution = Math.min(1, Math.sqrt(Math.max(0,width*height)) / 900);
  const q =
    0.25 * resolution +
    0.25 * Number(blurScore || 0) +
    0.20 * Number(exposureScore || 0) +
    0.30 * Number(subjectCoverage || 0);

  return Math.max(0, Math.min(1, q));
}
