/**
 * sizeGate.js
 * ============================================================================
 * MORIS M28 — SIZE CONTRACT & SIZE GATE (S1.1, query-side only, fail-open)
 *
 * Phần hợp đồng kích thước mirror 1:1 với src/moris/size-contract.js
 * (quy ước cạnh dài V1.2 chủ dự án chốt 2026-10-21):
 *  - cạnh dài bắt buộc, cạnh ngắn tùy chọn; thiếu cạnh ngắn -> 'match_partial'
 *    (chỉ đối chiếu cạnh dài, KHÔNG loại trừ).
 *  - mọi nguồn đo cùng 5% tính trên L_query, không sàn mm;
 *    cạnh ngắn chỉ là evidence hỗ trợ, không veto cạnh dài hợp lệ.
 *
 * Gate được chèn sau hydrate ANN, trước rankMetadata/structural/fusion (§5.5-5):
 *  - query thiếu size           -> status 'not_provided', không lọc (fail-open)
 *  - bảng catalogue_part_dimensions chưa có (Gate D) -> 'dims_unavailable', giữ nguyên
 *  - ứng viên thiếu dims        -> giữ nguyên + cờ size_status='unknown'
 *  - |delta| vượt dung sai      -> loại khỏi pool, ghi evidence size_rejected
 * ============================================================================
 */

import {headersForKey, serverKey} from '../connectors/supabaseService.js';

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

export const SIZE_DIMS_TABLE = 'catalogue_part_dimensions';

export const SIZE_GATE_MESSAGES = Object.freeze({
  dimsUnavailable:
    'Chưa có dữ liệu kích thước catalogue — em chưa lọc theo kích thước được.',
  neutral:
    'Chưa đủ dữ liệu để kết luận kích thước — anh chụp kèm thẻ chuẩn để lọc chính xác hơn.'
});

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

function lookupDims(dimsById, id) {
  if (!dimsById || !id) return null;
  if (dimsById instanceof Map) return dimsById.get(id) || null;
  if (typeof dimsById === 'object') return dimsById[id] || null;
  return null;
}

/**
 * Nạp dims ứng viên từ bảng proposal `catalogue_part_dimensions` (Gate D).
 * Fail-open: bảng chưa tồn tại / lỗi mạng / thiếu env -> trả null (không lọc).
 */
export async function loadCandidateDims(env, token, recordIds) {
  const ids = [...new Set((recordIds || []).map((id) => String(id || '').trim()).filter(Boolean))]
    .filter((id) => /^[a-z0-9-]{1,64}$/i.test(id));
  if (!ids.length) return new Map();

  const base = String(env?.SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base) return null;

  const key = serverKey(env);
  if (!key) return null;

  try {
    const result = new Map();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const params = new URLSearchParams();
      params.set('select', 'record_id,length_mm,width_mm,method,confidence');
      params.set('record_id', `in.(${ids.slice(offset, offset + 100).join(',')})`);
      const res = await fetch(`${base}/rest/v1/${SIZE_DIMS_TABLE}?${params.toString()}`, {
        headers: {...headersForKey(key), accept: 'application/json'}
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      if (!Array.isArray(data)) return null;
      for (const row of data) result.set(String(row?.record_id || ''), row);
    }
    return result;
  } catch {
    return null;
  }
}

/** Read-only length shortlist before ANN. A full final page means incomplete coverage. */
export async function loadLengthShortlist(env, querySize, {maxRows = 2000, pageSize = 200} = {}) {
  const size = normalizeQuerySize(querySize);
  if (!size) return {status: 'not_provided', rows: []};
  const base = String(env?.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = serverKey(env);
  if (!base || !key) return {status: 'dims_unavailable', rows: []};

  const allowed = toleranceForEdge(size.length_mm);
  const budget = Math.max(1, Math.min(5000, Math.floor(maxRows) || 2000));
  const page = Math.max(1, Math.min(500, Math.floor(pageSize) || 200));
  const rows = [];
  try {
    for (let offset = 0; offset <= budget; offset += page) {
      const limit = Math.min(page, budget - offset + 1);
      const params = new URLSearchParams({
        select: 'record_id,length_mm,width_mm,method,confidence',
        and: `(length_mm.gte.${size.length_mm - allowed},length_mm.lte.${size.length_mm + allowed})`,
        order: 'record_id.asc',
        limit: String(limit),
        offset: String(offset)
      });
      const res = await fetch(`${base}/rest/v1/${SIZE_DIMS_TABLE}?${params}`, {
        headers: {...headersForKey(key), accept: 'application/json'},
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) return {status: 'dims_unavailable', rows: []};
      const part = await res.json();
      if (!Array.isArray(part)) return {status: 'dims_unavailable', rows: []};
      rows.push(...part);
      if (rows.length > budget) return {status: 'budget_exceeded', rows: [], budget};
      if (part.length < limit) return {status: 'complete', rows, budget};
    }
    return {status: 'budget_exceeded', rows: [], budget};
  } catch {
    return {status: 'dims_unavailable', rows: []};
  }
}

/**
 * Áp Size Gate lên pool ứng viên (hàm thuần, testable).
 *
 * @param {object} args
 * @param {Array} args.candidates  - pool sau hydrate (mỗi row có id/record_id + code)
 * @param {object|null} args.querySize - size query đã chuẩn hoá (hoặc raw, sẽ chuẩn hoá lại)
 * @param {Map|object|null} args.dimsById - map record_id -> {length_mm,width_mm,method}; null = không đọc được
 * @param {object} [args.tolerance] - { relative, floorMm } override; mặc định chọn theo nguồn đo (S1.1)
 */
export function applySizeGate({
  candidates,
  querySize,
  dimsById,
  tolerance = null
} = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const queryPair = normalizeQuerySize(querySize);

  if (!queryPair) {
    return {
      candidates: list,
      rejected: [],
      evidence: { status: 'not_provided' },
      warnings: []
    };
  }

  if (dimsById == null) {
    return {
      candidates: list,
      rejected: [],
      evidence: {
        status: 'dims_unavailable',
        measured: queryPair,
        tolerance: resolveSizeTolerance(queryPair, null, tolerance)
      },
      warnings: [SIZE_GATE_MESSAGES.dimsUnavailable]
    };
  }

  const tol = resolveSizeTolerance(queryPair, null, tolerance);
  const kept = [];
  const rejected = [];
  const rescueCandidates = [];
  let unknownCount = 0;
  let partialCount = 0;

  for (const row of list) {
    const id = String(row?.record_id ?? row?.id ?? '');
    const dims = lookupDims(dimsById, id);
    const candidatePair = normalizeSizePair(dims?.length_mm, dims?.width_mm);

    if (!candidatePair) {
      unknownCount += 1;
      kept.push({ ...row, size_status: 'unknown' });
      continue;
    }

    const verdict = evaluateSizeMatch(
      queryPair,
      { ...candidatePair, method: dims?.method },
      tolerance
    );

    if (verdict.status === 'match' || verdict.status === 'match_partial') {
      if (verdict.status === 'match_partial') partialCount += 1;
      kept.push({
        ...row,
        size_status: verdict.status,
        size_evidence: {
          d_max: verdict.d_max,
          permutation: verdict.permutation,
          partial: verdict.status === 'match_partial',
          candidate: { ...candidatePair }
        }
      });
      continue;
    }

    rejected.push({
      id,
      code: row?.code ?? null,
      d_max: verdict.d_max,
      permutation: verdict.permutation,
      candidate: { ...candidatePair }
    });
    rescueCandidates.push({
      ...row,
      size_status:'outside_tolerance',
      size_evidence:{d_max:verdict.d_max,permutation:verdict.permutation,candidate:{...candidatePair},method:dims?.method||null}
    });
  }

  const warnings = rejected.length
    ? [
        `Đã chuyển ${rejected.length} mã khác kích thước ngoài dung sai ` +
          `(${Math.round(tol.relative * 100)}% theo cạnh dài đã nhập) sang nhóm đối chiếu phụ.`
      ]
    : [];

  return {
    candidates: kept,
    rescueCandidates,
    rejected,
    evidence: {
      status: 'applied',
      measured: queryPair,
      tolerance: tol,
      matched_count: kept.filter((row) => row.size_status === 'match').length,
      partial_count: partialCount,
      unknown_count: unknownCount,
      rejected_count: rejected.length,
      rejected: rejected.slice(0, 10)
    },
    warnings
  };
}
