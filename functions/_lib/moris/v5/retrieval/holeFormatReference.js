/**
 * holeFormatReference.js — Từ điển tham chiếu mềm định dạng lỗ (Moris V6, chủ dự án 2026-10-19)
 *
 * Mục tiêu: khi DINOv2/bộ phân tích camera có cơ sở đoán định dạng lỗ của ảnh query
 * (đếm theo hình dạng: tròn / vuông / oval / dài), đối chiếu MỀM với mô tả
 * `identifying_features` của ứng viên. CHỈ CỘNG (boost), KHÔNG BAO GIỜ PHẠT hay loại trừ —
 * "không quá khắc khe, chỉ tham khảo" (chủ dự án chốt).
 *
 * Nguồn nhãn: bảng moris_hole_samples (15 ảnh mẫu R2 hole-samples/, 11 định dạng).
 * Mọi thay đổi hành vi xếp hạng phải nằm sau feature flag `holeFormatBoost` (mặc định OFF)
 * và có đo lường trên dữ liệu thật trước khi bật (hiến pháp AGENTS.md).
 */
import { cleanFeatureText, removeVietnameseAccents, parseIdentifyingFeaturesAST } from "./featureMatcher.js";

/** 11 định dạng lỗ có mẫu tham chiếu (khớp format_tag trong moris_hole_samples). */
export const HOLE_FORMAT_TAGS = Object.freeze([
  "tron", "vuong", "oval", "oval_cong", "ban_oval", "dai",
  "chu_nhat", "chu_l", "tam_giac", "rang_cua", "gai_moc"
]);

/** Tên hiển thị tiếng Việt cho thông điệp Moris. */
export const HOLE_FORMAT_NAMES = Object.freeze({
  tron: "Lỗ tròn",
  vuong: "Lỗ vuông",
  oval: "Lỗ oval",
  oval_cong: "Lỗ oval cong",
  ban_oval: "Lỗ bán oval",
  dai: "Lỗ dài",
  chu_nhat: "Lỗ chữ nhật",
  chu_l: "Lỗ chữ L",
  tam_giac: "Lỗ tam giác",
  rang_cua: "Lỗ răng cưa",
  gai_moc: "Lỗ gài móc"
});

/**
 * Từ vựng nhận diện (đã bỏ dấu, chữ thường).
 * Thứ tự quan trọng: kiểm tra cụ thể trước (oval cong trước oval).
 * Riêng "dài/rãnh" BẮT BUỘC có ngữ cảnh "lỗ" phía trước để tránh nhầm với
 * mô tả kích thước ("thân dài 20mm", "rãnh dầu"...).
 */
const FORMAT_PATTERNS = [
  { tag: "ban_oval", match: /\b(?:ban|semi|half)[\s-]+oval\b/ },
  { tag: "oval_cong", match: /\boval\s+cong\b/ },
  { tag: "chu_nhat", match: /\b(?:chu nhat|rectangle)\b/ },
  { tag: "chu_l", match: /\bchu\s+l\b/ },
  { tag: "tam_giac", match: /\b(?:tam giac|triangle)\b/ },
  { tag: "rang_cua", match: /\b(?:rang cua|sawtooth|saw tooth)\b/ },
  { tag: "gai_moc", match: /\b(?:gai moc|hook clip|hook)\b/ },
  { tag: "dai", match: /\blo\s+(?:dai|ranh|slot|oblong)\b|\b(?:slot|oblong)\s+lo\b/ },
  { tag: "oval", match: /\b(?:oval|bau duc|ellipse)\b/ },
  { tag: "vuong", match: /\b(?:vuong|square)\b/ },
  { tag: "tron", match: /\b(?:tron|round|circular)\b/ }
];

/** Chuẩn hóa text về chữ thường không dấu, gọn khoảng trắng. */
export function normalizeFormatText(text) {
  return removeVietnameseAccents(cleanFeatureText(text));
}

/**
 * Suy ra tập định dạng lỗ xuất hiện trong 1 đoạn mô tả (identifying_features / câu query).
 * Trả về mảng tag (thứ tự FORMAT_PATTERNS, không trùng).
 */
export function inferFormatTagsFromText(text) {
  const norm = normalizeFormatText(text);
  if (!norm) return [];
  const tags = [];
  for (const { tag, match } of FORMAT_PATTERNS) {
    if (match.test(norm) && !tags.includes(tag)) tags.push(tag);
  }
  // Leaf oval labels không được tự nhân đôi thành nhãn parent oval.
  return tags.filter(tag => tag !== 'oval' || (!tags.includes('ban_oval') && !tags.includes('oval_cong')));
}

const COUNT_KEY_TO_TAG = Object.freeze({
  circle: "tron",
  round: "tron",
  square: "vuong",
  oval: "oval",
  slot: "dai"
});

/**
 * Chuyển đếm hình dạng phía client (analyzeHoles.counts) thành tag định dạng.
 * Nhận cả khóa tag trực tiếp (tron/vuong/oval/dai...). Bỏ qua unknown/0.
 * @returns {string[]} tag có số lượng > 0
 */
export function holeFormatsFromCounts(counts) {
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return [];
  const tags = [];
  for (const [key, value] of Object.entries(counts)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    const tag = COUNT_KEY_TO_TAG[key] || (HOLE_FORMAT_TAGS.includes(key) ? key : null);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

const COUNT_WORDS = Object.freeze({
  tron:'tron',vuong:'vuong',oval:'oval',oval_cong:'oval cong',ban_oval:'ban oval',
  dai:'dai',chu_nhat:'chu nhat',chu_l:'chu l',tam_giac:'tam giac',
  rang_cua:'rang cua',gai_moc:'gai moc'
});

function explicitFormatCounts(text) {
  const norm = normalizeFormatText(text);
  const counts = {...parseIdentifyingFeaturesAST(text).shapeCounts};
  for (const [tag, phrase] of Object.entries(COUNT_WORDS)) {
    // Leaf labels need an explicit number next to "lỗ"; unnumbered prose is unknown.
    const pattern = new RegExp(`(?:^|\\W)(\\d+)\\s+lo\\s+${phrase.replace(/ /g,'\\s+')}\\b`, 'g');
    let match;
    while ((match = pattern.exec(norm)) !== null) {
      if (tag === 'tron' || tag === 'vuong' || tag === 'oval' || tag === 'chu_nhat' || tag === 'tam_giac') continue;
      counts[tag] = (counts[tag] || 0) + Number(match[1]);
    }
  }
  return counts;
}

/**
 * Đối chiếu mềm: đánh dấu ứng viên có định dạng lỗ khớp query.
 * CHỈ đánh dấu khi khớp; ứng viên không khớp KHÔNG nhận cờ (boost-only, không phạt).
 */
export function applyHoleFormatBoost({ rows, queryTags, queryCounts = null, delta = 0.05 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const querySet = new Set(Array.isArray(queryTags) ? queryTags.filter(t => HOLE_FORMAT_TAGS.includes(t)) : []);
  if (!querySet.size) {
    return { rows: list, evidence: null };
  }

  const matchedPerTag = {};
  const out = list.map(row => {
    const tags = inferFormatTagsFromText(row?.identifying_features);
    const counts = explicitFormatCounts(row?.identifying_features);
    const matched = tags.filter(t => {
      if (!querySet.has(t)) return false;
      const expected = queryCounts?.[t];
      if (Number.isInteger(expected) && expected > 0) return counts[t] === expected;
      return true;
    });
    if (!matched.length) return row;
    for (const t of matched) matchedPerTag[t] = (matchedPerTag[t] || 0) + 1;
    return {
      ...row,
      hole_format_score: 1,
      hole_format_available: true,
      hole_format_match: matched
    };
  });

  const matchedCount = out.filter(r => r?.hole_format_available === true).length;
  return {
    rows: out,
    evidence: {
      version: "hole_format_ref_v1",
      query_tags: [...querySet],
      count_mode: queryCounts ? 'exact_when_provided' : 'tag_only',
      matched_count: matchedCount,
      delta: Number(delta),
      matched_per_tag: matchedPerTag
    }
  };
}
