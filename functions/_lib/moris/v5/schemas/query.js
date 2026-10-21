import { normalizeGeometry } from "./geometry.js";
import { normalizeQuerySize } from "../retrieval/sizeGate.js";
import { HOLE_FORMAT_TAGS } from "../retrieval/holeFormatReference.js";

const HOLE_FORMAT_TAG_SET = new Set(HOLE_FORMAT_TAGS);

// Client-supplied diagnostics only. Never use this claim as server-trusted ranking/GT.
export function normalizeCaptureQuality(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!['camera','upload'].includes(value.source_kind) || value.gate_status !== 'passed') return null;
  const width = value.frame_width_px, height = value.frame_height_px;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 10000 || height > 10000) return null;
  const stability = value.source_kind === 'camera' ? 'verified_live' : 'not_applicable_static';
  if (value.temporal_stability !== stability) return null;
  const roi = value.crop_roi;
  if (value.source_kind === 'camera') {
    if (!roi || ![roi.x,roi.y,roi.width,roi.height].every(Number.isInteger) ||
        roi.x < 0 || roi.y < 0 || roi.width <= 0 || roi.height <= 0 ||
        roi.x + roi.width > width || roi.y + roi.height > height) return null;
  } else if (roi != null) return null;
  const consistency = value.optical_consistency;
  let normalizedConsistency = null;
  if (consistency != null) {
    if (!consistency || !['agree','mismatch','unknown'].includes(consistency.status)) return null;
    if (consistency.status === 'unknown') {
      if (!['missing_evidence','low_quality_or_unknown_holes'].includes(consistency.reason)) return null;
      normalizedConsistency = { status:'unknown', reason:consistency.reason };
    } else {
      const a=consistency.capture_closed_count, b=consistency.optical_closed_count;
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 999 || b > 999) return null;
      normalizedConsistency={status:consistency.status,capture_closed_count:a,optical_closed_count:b};
    }
  }
  return {
    source_kind:value.source_kind,
    frame_width_px:width,
    frame_height_px:height,
    crop_roi:roi ? { x:roi.x, y:roi.y, width:roi.width, height:roi.height } : null,
    gate_status:'passed',
    temporal_stability:stability,
    ...(normalizedConsistency ? {optical_consistency:normalizedConsistency} : {})
  };
}

// Từ điển mẫu lỗ (2026-10-19): đếm định dạng lỗ phía client -> { tag: count }.
// Fail-open: payload sai/không nhận dạng được -> null (không boost).
function normalizeHoleFormats(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!HOLE_FORMAT_TAG_SET.has(key)) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 9999) continue;
    out[key] = n;
  }
  return Object.keys(out).length ? out : null;
}

function assertEmbedding(vector,dimension,label){
  if(!Array.isArray(vector) || vector.length!==dimension){
    const e=new Error(`${label} phải đúng ${dimension} chiều.`);
    e.status=400; throw e;
  }
  for(const value of vector){
    if(typeof value!=="number" || !Number.isFinite(value)){
      const e=new Error(`${label} chứa giá trị không hợp lệ.`);
      e.status=400; throw e;
    }
  }
  if(Math.hypot(...vector)<1e-8){const e=new Error(`${label} không được là vector zero.`);e.status=400;throw e;}
  return [...vector];
}

export function validateMorisQuery(body, config) {
  const message = String(body?.message || "").trim();
  const image = String(body?.image_data_url || "");
  const embedding = body?.query_embedding;
  const probes = Array.isArray(body?.query_embeddings)
    ? body.query_embeddings.slice(0,3)
    : [];

  if (!message && !image && !Array.isArray(embedding) && !probes.length) {
    const e = new Error("Cần message, image_data_url hoặc query embedding.");
    e.status = 400;
    throw e;
  }

  if (image && image.length > config.limits.maxImageDataUrlChars) {
    const e = new Error("image_data_url quá lớn.");
    e.status = 413;
    throw e;
  }

  const queryEmbedding = Array.isArray(embedding)
    ? assertEmbedding(embedding,config.vector.dimension,'query_embedding')
    : null;

  const queryEmbeddings = probes.map((probe,index)=>({
    probe_id:String(probe?.probe_id || `probe_${index+1}`).slice(0,40),
    embedding:assertEmbedding(
      probe?.embedding,
      config.vector.dimension,
      `query_embeddings[${index}]`
    ),
    embedding_profile:probe?.embedding_profile || body?.embedding_profile || null
  }));

  const usageSide=body?.filters?.usage_side || "all";
  const viewMode=body?.filters?.view_mode || "all";
  if (!["all","left","right","both","unknown"].includes(usageSide) ||
      !["all","single_face","dual_face","detail_set"].includes(viewMode)) {
    const error=new Error("Bộ lọc Moris không hợp lệ.");error.status=400;throw error;
  }
  return {
    query_id:String(body?.query_id || crypto.randomUUID()),
    message,
    image_data_url:image,
    query_embedding:queryEmbedding,
    query_embeddings:queryEmbeddings,
    embedding_profile:body?.embedding_profile || null,
    filters:{
      usage_side:usageSide,
      view_mode:viewMode
    },
    hints:body?.hints || {},
    geometry:body?.geometry ? normalizeGeometry(body.geometry) : null,
    // M28 Size Contract (S1): fail-open — payload size không hợp lệ trở thành null.
    size:normalizeQuerySize(body?.size),
    // Từ điển mẫu lỗ: đếm định dạng lỗ (tròn/vuông/oval/dài) từ phân tích camera.
    hole_formats:normalizeHoleFormats(body?.hole_formats),
    capture_quality:normalizeCaptureQuality(body?.capture_quality)
  };
}
