/**
 * geometricReranker.js — Thuật toán Re-Ranking hình học Lớp 3 cho hệ thống tìm kiếm linh kiện Moris.
 * 
 * Kết hợp:
 * - DINOv2 Coarse Vector Similarity (S_vec - Trọng số 45%)
 * - Hole Topology & Centroid Distribution (S_holes - Trọng số 40%)
 * - Aspect Ratio Congruence (S_ratio - Trọng số 15%)
 * 
 * Hỗ trợ:
 * - Bất biến lật mặt sau (Mirror Invariant: x <-> 1 - x)
 * - Phát hiện sai lệch số lỗ dập < 5% hình học
 */

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v || 0)));
}

/**
 * Tính khoảng cách Euclid trung bình giữa hai tập tâm lỗ đã sắp xếp tăng dần theo X.
 */
function computeCentroidDistance(qCentroids, dbCentroids) {
  const n = qCentroids.length;
  if (n === 0) return 0;

  let sumDist = 0;
  for (let i = 0; i < n; i++) {
    const q = qCentroids[i];
    const d = dbCentroids[i];
    const dx = Number(q?.x || 0) - Number(d?.x || 0);
    const dy = Number(q?.y || 0) - Number(d?.y || 0);
    sumDist += Math.hypot(dx, dy);
  }

  return sumDist / n;
}

/**
 * Tính điểm tương đồng cấu trúc lỗ S_holes giữa ảnh query và bản ghi DB.
 * Có xử lý bất biến phản xạ gương khi người dùng lật mặt sau chi tiết.
 */
export function computeHoleSimilarity(queryHoles, dbHoles) {
  const qCount = Number(queryHoles?.hole_count ?? (Array.isArray(queryHoles?.hole_centroids) ? queryHoles.hole_centroids.length : 0));
  const dbCount = Number(dbHoles?.hole_count ?? (Array.isArray(dbHoles?.hole_centroids) ? dbHoles.hole_centroids.length : 0));

  // Nếu số lượng lỗ khác nhau
  const diff = Math.abs(qCount - dbCount);
  if (diff >= 1) {
    // Lệch 1 lỗ -> 0.5, lệch >= 2 lỗ -> 0.0
    return Math.max(0, 1.0 - 0.5 * diff);
  }

  // Trường hợp cả hai đều không có lỗ nào
  if (qCount === 0 && dbCount === 0) {
    return 1.0;
  }

  // Cả hai có cùng số lượng lỗ (N >= 1) -> So khớp tọa độ tâm
  const qArr = Array.isArray(queryHoles?.hole_centroids) ? [...queryHoles.hole_centroids] : [];
  const dbArr = Array.isArray(dbHoles?.hole_centroids) ? [...dbHoles.hole_centroids] : [];

  if (qArr.length === 0 || dbArr.length === 0 || qArr.length !== dbArr.length) {
    return 0.85; // Cùng count nhưng thiếu chi tiết centroid
  }

  // Sắp xếp tăng dần theo X
  qArr.sort((a, b) => Number(a.x || 0) - Number(b.x || 0));
  dbArr.sort((a, b) => Number(a.x || 0) - Number(b.x || 0));

  // Kịch bản 1: Giữ nguyên hướng
  const distDirect = computeCentroidDistance(qArr, dbArr);

  // Kịch bản 2: Lật mặt sau (Mirror Invariant: x' = 1 - x)
  const qMirrored = qArr.map(p => ({
    ...p,
    x: 1.0 - Number(p.x || 0)
  })).sort((a, b) => a.x - b.x);

  const distMirror = computeCentroidDistance(qMirrored, dbArr);

  const bestDist = Math.min(distDirect, distMirror);
  return clamp01(1.0 - bestDist);
}

/**
 * Tính điểm tương đồng tỷ lệ khung hình S_ratio.
 */
export function computeAspectRatioSimilarity(qAR, dbAR) {
  const a = Math.max(0.01, Number(qAR || 1.0));
  const b = Math.max(0.01, Number(dbAR || 1.0));
  const diff = Math.abs(a - b);
  const maxAR = Math.max(a, b);
  return clamp01(1.0 - diff / maxAR);
}

/**
 * Chấm điểm tổng hợp S_final cho một ứng viên.
 * S_final = 0.45 * S_vec + 0.40 * S_holes + 0.15 * S_ratio
 */
export function scoreCandidateGeometry(candidate, queryGeometry, weights = { wVec: 0.45, wHoles: 0.40, wRatio: 0.15 }) {
  const sVec = clamp01(candidate?.vector_similarity ?? candidate?.similarity ?? 0);

  // Nếu không có thông tin hình học của query -> Fallback điểm vector gốc
  if (!queryGeometry || queryGeometry.hole_count === undefined) {
    return {
      final_score: sVec,
      s_vec: sVec,
      s_holes: 1.0,
      s_ratio: 1.0,
      geometric_warning: null
    };
  }

  const sHoles = computeHoleSimilarity(queryGeometry, {
    hole_count: candidate?.hole_count ?? 0,
    hole_centroids: candidate?.hole_centroids ?? []
  });

  const sRatio = computeAspectRatioSimilarity(
    queryGeometry?.aspect_ratio ?? 1.0,
    candidate?.aspect_ratio ?? 1.0
  );

  const finalScore = Number((
    weights.wVec * sVec +
    weights.wHoles * sHoles +
    weights.wRatio * sRatio
  ).toFixed(4));

  let warning = null;
  const qCount = Number(queryGeometry.hole_count || 0);
  const dbCount = Number(candidate?.hole_count || 0);

  if (sVec > 0.85 && qCount !== dbCount) {
    warning = `Kiểu dáng giống (${Math.round(sVec * 100)}%) nhưng khác số lỗ: Ảnh chụp có ${qCount} lỗ, catalogue có ${dbCount} lỗ.`;
  }

  return {
    final_score: finalScore,
    s_vec: sVec,
    s_holes: Number(sHoles.toFixed(4)),
    s_ratio: Number(sRatio.toFixed(4)),
    geometric_warning: warning
  };
}

/**
 * Tái sắp xếp (Re-rank) danh sách ứng viên dựa trên hình học.
 */
export function rerankCandidatesByGeometry(candidates, queryGeometry, options = {}) {
  const list = Array.isArray(candidates) ? [...candidates] : [];
  if (!list.length) return [];

  const scored = list.map(c => {
    const geo = scoreCandidateGeometry(c, queryGeometry, options.weights);
    return {
      ...c,
      geometric_score: geo.final_score,
      s_vec: geo.s_vec,
      s_holes: geo.s_holes,
      s_ratio: geo.s_ratio,
      geometric_warning: geo.geometric_warning
    };
  });

  scored.sort((a, b) => b.geometric_score - a.geometric_score);
  return scored;
}
