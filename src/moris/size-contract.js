/**
 * size-contract.js
 * ============================================================================
 * MORIS M28 — SIZE CONTRACT (S1.1, query-side only, fail-open)
 *
 * Quy ước kích thước (pipeline_moris.md §10.3, chủ dự án Q1/Q5/Q6/Q9 + chốt S1.1
 * 2026-10-19):
 *  - Lưu/so khớp cặp (length_mm, width_mm) theo trục chính PCA, luôn L >= W.
 *  - Bất biến góc xoay/hướng chụp: người dùng chỉ nhập "cạnh dài nhất" và
 *    "cạnh ngắn nhất"; nếu nhập ngược thứ tự, tự động hoán vị (L >= W).
 *  - S1.1: **cạnh dài bắt buộc, cạnh ngắn tùy chọn** — thiếu width_mm vẫn hợp lệ,
 *    khi so khớp chỉ đối chiếu cạnh dài (status 'match_partial'), KHÔNG loại trừ.
 *  - Hình vuông KHÔNG special case: shape_class = 'square' chỉ khi
 *    |L-W| / max(L,W) <= 5% (dùng để hiển thị/nhóm, không dùng để tính);
 *    thiếu cạnh ngắn -> shape_class = null (không kết luận).
 *  - V1.2: cạnh dài là điều kiện lọc; d_max = |L_candidate-L_query|/L_query.
 *    Cạnh ngắn chỉ là evidence hỗ trợ, không veto cạnh dài hợp lệ.
 *  - Chủ dự án chốt 2026-10-21: tất cả nguồn đo cùng ngưỡng 5% theo L_query,
 *    không có sàn mm. Hợp đồng S1.1 trước đây 10%/3mm đã được thay thế.
 *  - Trạng thái trung tính (Q8): thiếu cạnh dài query hoặc thiếu dims catalogue
 *    thì KHÔNG lọc (fail-open), chỉ ghi evidence.
 *
 * Module thuần, DOM-free, mirror với functions/_lib/moris/v5/retrieval/sizeGate.js.
 * ============================================================================
 */

export const SIZE_CONTRACT_VERSION = 'size_contract_v1_2';

export const DEFAULT_SIZE_TOLERANCE = Object.freeze({
  relative: 0.05,
  floorMm: 0
});

/** Giữ hai nhãn nguồn để tương thích payload cũ; ngưỡng V1.2 như nhau. */
export const SIZE_TOLERANCE_BY_SOURCE = Object.freeze({
  verified: Object.freeze({ relative: 0.05, floorMm: 0 }),
  manual: Object.freeze({ relative: 0.05, floorMm: 0 })
});

export const SIZE_VERIFIED_METHODS = Object.freeze(['caliper', 'marker_photo', 'erp']);
export const SIZE_VERIFIED_SOURCES = Object.freeze(['caliper', 'marker_photo', 'erp', 'camera_measured']);

export const SIZE_SQUARE_CLASS_MAX_DIFF = 0.05;

export const SIZE_MAX_MM = 5000;

const SIZE_ROUND_DIGITS = 6;

function round(value, digits = SIZE_ROUND_DIGITS) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitizeTolerance(tolerance) {
  const relative = toFiniteNumber(tolerance?.relative);
  const floorMm = toFiniteNumber(tolerance?.floorMm);
  return {
    relative: relative != null && relative >= 0 ? relative : DEFAULT_SIZE_TOLERANCE.relative,
    floorMm: floorMm != null && floorMm >= 0 ? floorMm : DEFAULT_SIZE_TOLERANCE.floorMm
  };
}

/**
 * Chuẩn hoá cặp kích thước về quy ước (L >= W).
 * S1.1: cạnh dài bắt buộc, cạnh ngắn tùy chọn — chỉ truyền 1 số thì số đó là
 * cạnh dài (width_mm = null). Trả về null nếu thiếu cả hai / không hợp lệ.
 */
export function normalizeSizePair(length, width, { maxMm = SIZE_MAX_MM } = {}) {
  const l = toFiniteNumber(length);
  const w = toFiniteNumber(width);
  if (l == null && w == null) return null;
  const cap = toFiniteNumber(maxMm) ?? SIZE_MAX_MM;
  if (l == null) {
    if (w <= 0 || w > cap) return null;
    return { length_mm: w, width_mm: null };
  }
  if (l <= 0 || l > cap) return null;
  if (w == null) return { length_mm: l, width_mm: null };
  if (w <= 0 || w > cap) return null;
  return l >= w
    ? { length_mm: l, width_mm: w }
    : { length_mm: w, width_mm: l };
}

export function shapeClass(lengthMm, widthMm) {
  const pair = normalizeSizePair(lengthMm, widthMm);
  if (!pair || pair.width_mm == null) return null;
  const diff = Math.abs(pair.length_mm - pair.width_mm) / pair.length_mm;
  return diff <= SIZE_SQUARE_CLASS_MAX_DIFF ? 'square' : 'rect';
}

/** Ngưỡng tuyệt đối theo tỷ lệ query; mặc định không có sàn mm. */
export function toleranceForEdge(refMm, tolerance = DEFAULT_SIZE_TOLERANCE) {
  const ref = toFiniteNumber(refMm);
  if (ref == null || ref <= 0) return null;
  const tol = sanitizeTolerance(tolerance);
  return Math.max(tol.relative * ref, tol.floorMm);
}

/** Bên đo có phải số đo kiểm chuẩn (không phải nhập tay) không. */
export function isVerifiedMeasurement(side) {
  if (!side || typeof side !== 'object') return false;
  const method = String(side.method || '').trim().toLowerCase();
  const source = String(side.source || '').trim().toLowerCase();
  return SIZE_VERIFIED_METHODS.includes(method) || SIZE_VERIFIED_SOURCES.includes(source);
}

/**
 * Chọn dung sai cho một phép so khớp (V1.2).
 * - explicit (tham số tolerance truyền thẳng) luôn thắng (test/override).
 * - Các nguồn đo đều dùng 5% không sàn mm theo quyết định 2026-10-21.
 */
export function resolveSizeTolerance(querySide, candidateSide, explicit) {
  const relative = toFiniteNumber(explicit?.relative);
  const floorMm = toFiniteNumber(explicit?.floorMm);
  if (relative != null || floorMm != null) return sanitizeTolerance(explicit);
  const verified = isVerifiedMeasurement(querySide) && isVerifiedMeasurement(candidateSide);
  const chosen = verified ? SIZE_TOLERANCE_BY_SOURCE.verified : SIZE_TOLERANCE_BY_SOURCE.manual;
  return { relative: chosen.relative, floorMm: chosen.floorMm };
}

function compareEdges(queryPair, candidatePair, tolerance) {
  const tol = sanitizeTolerance(tolerance);
  const hasWidth = queryPair.width_mm != null && candidatePair.width_mm != null;
  const keys = hasWidth ? ['length_mm', 'width_mm'] : ['length_mm'];
  const edges = keys.map((key) => {
    const q = queryPair[key];
    const c = candidatePair[key];
    const delta = Math.abs(q - c);
    const ref = q;
    const allowed = Math.max(tol.relative * ref, tol.floorMm);
    return {
      key,
      delta: round(delta),
      allowed: round(allowed),
      ok: delta <= allowed + 1e-9
    };
  });
  const longEdge = edges[0];
  const dMax = longEdge.delta / queryPair.length_mm;
  return {
    ok: longEdge.ok,
    partial: !hasWidth,
    d_max: round(dMax),
    edges
  };
}

/**
 * Khoảng cách cạnh dài chuẩn hoá theo L_query. Cạnh ngắn không tham gia gate.
 * Trả về null nếu một trong hai cặp không hợp lệ.
 */
export function sizeDistance(queryPair, candidatePair) {
  const q = normalizeSizePair(
    queryPair?.length_mm ?? queryPair?.lengthMm,
    queryPair?.width_mm ?? queryPair?.widthMm
  );
  const c = normalizeSizePair(
    candidatePair?.length_mm ?? candidatePair?.lengthMm,
    candidatePair?.width_mm ?? candidatePair?.widthMm
  );
  if (!q || !c) return null;
  return compareEdges(q, c, DEFAULT_SIZE_TOLERANCE).d_max;
}

/**
 * So khớp 1 ứng viên với size query.
 * status: 'match' | 'match_partial' | 'mismatch' | 'unknown'
 *  - 'match'         : đủ 2 cạnh và nằm trong dung sai.
 *  - 'match_partial' : thiếu cạnh ngắn (1 trong 2 bên) — chỉ đối chiếu cạnh dài,
 *                      giữ nguyên ứng viên (S1.1, không loại trừ oan).
 *  - 'unknown'       : thiếu cạnh dài/không hợp lệ -> trung tính, giữ nguyên.
 */
export function evaluateSizeMatch(queryPair, candidatePair, tolerance) {
  const q = normalizeSizePair(
    queryPair?.length_mm ?? queryPair?.lengthMm,
    queryPair?.width_mm ?? queryPair?.widthMm
  );
  const c = normalizeSizePair(
    candidatePair?.length_mm ?? candidatePair?.lengthMm,
    candidatePair?.width_mm ?? candidatePair?.widthMm
  );
  if (!q || !c) {
    return {
      status: 'unknown',
      permutation: null,
      d_max: null,
      edges: [],
      tolerance: null
    };
  }

  const tol = resolveSizeTolerance(queryPair, candidatePair, tolerance);
  const identity = compareEdges(q, c, tol);

  const chosen = identity;
  const permutation = 'identity';

  return {
    status: chosen.ok ? (chosen.partial ? 'match_partial' : 'match') : 'mismatch',
    permutation,
    d_max: chosen.d_max,
    edges: chosen.edges,
    tolerance: tol
  };
}

/**
 * Chuẩn hoá payload size từ query (`body.size`) — fail-open: trả null nếu không hợp lệ.
 * Chấp nhận { length_mm, width_mm?, source?, confidence? } — cạnh dài bắt buộc,
 * cạnh ngắn tùy chọn (S1.1).
 */
export function normalizeQuerySize(input) {
  if (!input || typeof input !== 'object') return null;
  const pair = normalizeSizePair(
    input.length_mm ?? input.lengthMm,
    input.width_mm ?? input.widthMm
  );
  if (!pair) return null;

  const source =
    typeof input.source === 'string' && /^[a-z0-9_]{1,32}$/.test(input.source)
      ? input.source
      : 'unknown';
  const confidence =
    typeof input.confidence === 'number' &&
    Number.isFinite(input.confidence) &&
    input.confidence >= 0 &&
    input.confidence <= 1
      ? input.confidence
      : null;

  return {
    length_mm: pair.length_mm,
    width_mm: pair.width_mm,
    shape_class: shapeClass(pair.length_mm, pair.width_mm),
    source,
    confidence
  };
}

export function formatSizePair(pair) {
  const normalized = normalizeSizePair(
    pair?.length_mm ?? pair?.lengthMm,
    pair?.width_mm ?? pair?.widthMm
  );
  if (!normalized) return '';
  const fmt = (value) => {
    const rounded = Math.round(value * 10) / 10;
    return String(rounded);
  };
  if (normalized.width_mm == null) return `${fmt(normalized.length_mm)} mm`;
  return `${fmt(normalized.length_mm)} × ${fmt(normalized.width_mm)} mm`;
}
