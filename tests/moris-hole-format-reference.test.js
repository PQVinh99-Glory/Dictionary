import { describe, it, expect } from 'vitest';
import {
  HOLE_FORMAT_TAGS,
  HOLE_FORMAT_NAMES,
  inferFormatTagsFromText,
  holeFormatsFromCounts,
  applyHoleFormatBoost
} from '../functions/_lib/moris/v5/retrieval/holeFormatReference.js';
import { fuseCandidateScore } from '../functions/_lib/moris/v5/retrieval/scoreFusion.js';
import { validateMorisQuery } from '../functions/_lib/moris/v5/schemas/query.js';
import { readMorisConfig } from '../functions/_lib/moris/v5/runtime/config.js';
import { buildMorisUserMessage, MORIS_PUBLIC_MESSAGES } from '../functions/_lib/moris/v5/presentation/userMessage.js';

describe('holeFormatReference — từ điển mẫu lỗ (chủ dự án chốt 2026-10-19)', () => {
  it('11 định dạng khớp format_tag trong moris_hole_samples + tên hiển thị tiếng Việt', () => {
    expect(HOLE_FORMAT_TAGS).toEqual([
      'tron', 'vuong', 'oval', 'oval_cong', 'ban_oval', 'dai',
      'chu_nhat', 'chu_l', 'tam_giac', 'rang_cua', 'gai_moc'
    ]);
    for (const tag of HOLE_FORMAT_TAGS) {
      expect(HOLE_FORMAT_NAMES[tag]).toMatch(/^Lỗ /);
    }
  });

  it('suy định dạng từ mô tả identifying_features (bỏ dấu, chữ thường)', () => {
    expect(inferFormatTagsFromText('2 lỗ tròn, 4 Lỗ vuông')).toEqual(['vuong', 'tron']);
    expect(inferFormatTagsFromText('1 lỗ dài')).toEqual(['dai']);
    expect(inferFormatTagsFromText('2 lỗ dài (1)')).toEqual(['dai']);
    expect(inferFormatTagsFromText('Lỗ oval cong')).toEqual(['oval_cong']);
    expect(inferFormatTagsFromText('Lỗ bán oval')).toEqual(['ban_oval']);
    expect(inferFormatTagsFromText('2 lỗ bán-oval')).toEqual(['ban_oval']);
    expect(inferFormatTagsFromText('2 lỗ chữ nhật')).toEqual(['chu_nhat']);
    expect(inferFormatTagsFromText('1 lỗ chữ L')).toEqual(['chu_l']);
    expect(inferFormatTagsFromText('3 lỗ tam giác')).toEqual(['tam_giac']);
    expect(inferFormatTagsFromText('lỗ răng cưa')).toEqual(['rang_cua']);
    expect(inferFormatTagsFromText('lỗ gài móc')).toEqual(['gai_moc']);
    expect(inferFormatTagsFromText('')).toEqual([]);
  });

  it('"dài" cần ngữ cảnh "lỗ" — không nhầm mô tả kích thước', () => {
    expect(inferFormatTagsFromText('thân dài 20mm, rộng 8mm')).toEqual([]);
    expect(inferFormatTagsFromText('2 rãnh dài trên thân')).toEqual([]);
    expect(inferFormatTagsFromText('1 lỗ dài xuyên thân')).toEqual(['dai']);
  });

  it('holeFormatsFromCounts ánh xạ counts camera → tag, bỏ unknown/0', () => {
    expect(holeFormatsFromCounts({ circle: 2, square: 1, oval: 0, slot: 3, unknown: 5 }))
      .toEqual(['tron', 'vuong', 'dai']);
    expect(holeFormatsFromCounts({ dai: 2, tron: 1 })).toEqual(['dai', 'tron']);
    expect(holeFormatsFromCounts(null)).toEqual([]);
    expect(holeFormatsFromCounts('circle')).toEqual([]);
  });

  it('boost-only: chỉ đánh dấu ứng viên khớp, KHÔNG phạt/đổi ứng viên không khớp', () => {
    const rows = [
      { id: 'a', identifying_features: '2 lỗ dài' },
      { id: 'b', identifying_features: '2 lỗ tròn' },
      { id: 'c' }
    ];
    const { rows: out, evidence } = applyHoleFormatBoost({ rows, queryTags: ['dai'] });
    expect(out[0]).toMatchObject({ hole_format_score: 1, hole_format_available: true, hole_format_match: ['dai'] });
    expect(out[1].hole_format_available).toBeUndefined();
    expect(out[1].hole_format_score).toBeUndefined();
    expect(out[2].hole_format_available).toBeUndefined();
    expect(evidence).toMatchObject({ version: 'hole_format_ref_v1', query_tags: ['dai'], matched_count: 1, matched_per_tag: { dai: 1 } });
  });

  it('query 4 lỗ tròn chỉ boost mã ghi chính xác 4, không coi 2/6/unknown là cùng nhãn', () => {
    const rows=[
      {id:'two',identifying_features:'2 lỗ tròn'},
      {id:'four',identifying_features:'4 lỗ tròn'},
      {id:'six',identifying_features:'6 lỗ tròn'},
      {id:'unknown',identifying_features:'có lỗ tròn'}
    ];
    const out=applyHoleFormatBoost({rows,queryTags:['tron'],queryCounts:{tron:4}}).rows;
    expect(out.filter(row=>row.hole_format_available).map(row=>row.id)).toEqual(['four']);
    expect(out[0].hole_format_score).toBeUndefined();
    expect(out[2].hole_format_score).toBeUndefined();
  });

  it('không có queryTags → không đánh dấu gì, evidence null (fail-open)', () => {
    const rows = [{ id: 'a', identifying_features: '2 lỗ dài' }];
    const { rows: out, evidence } = applyHoleFormatBoost({ rows, queryTags: [] });
    expect(evidence).toBeNull();
    expect(out[0].hole_format_available).toBeUndefined();
  });

  it('tag ngoài từ điển bị bỏ qua', () => {
    const { evidence } = applyHoleFormatBoost({ rows: [{ id: 'a', identifying_features: '2 lỗ dài' }], queryTags: ['la_bo', 'dai'] });
    expect(evidence.query_tags).toEqual(['dai']);
  });
});

describe('scoreFusion — tín hiệu hole_format boost-only', () => {
  it('ứng viên khớp định dạng được cộng điểm; ứng viên không khớp giữ nguyên', () => {
    const withMatch = fuseCandidateScore({ vector_similarity: .8, hole_format_score: 1, hole_format_available: true });
    const without = fuseCandidateScore({ vector_similarity: .8 });
    expect(withMatch.final_score).toBeGreaterThan(without.final_score);
    const names = withMatch.score_breakdown.signals.map(s => s.name);
    expect(names).toContain('hole_format');
    expect(without.score_breakdown.signals.map(s => s.name)).not.toContain('hole_format');
  });

  it('không có tín hiệu hole_format khi unavailable → final_score thuần vector', () => {
    expect(fuseCandidateScore({ vector_similarity: .8, hole_format_score: 1 }).final_score).toBe(.8);
  });
});

describe('query schema — hole_formats fail-open', () => {
  const config = readMorisConfig({});

  it('nhận tag hợp lệ, bỏ tag lạ và giá trị không hợp lệ', () => {
    const q = validateMorisQuery({ message: 'x', hole_formats: { dai: 2, tron: 1, la_bo: 5, vuong: -1, oval: 3.5 } }, config);
    expect(q.hole_formats).toEqual({ dai: 2, tron: 1 });
  });

  it('payload sai → null; flag holeFormatBoost mặc định OFF', () => {
    expect(validateMorisQuery({ message: 'x', hole_formats: 'dai' }, config).hole_formats).toBeNull();
    expect(validateMorisQuery({ message: 'x', hole_formats: { la_bo: 1 } }, config).hole_formats).toBeNull();
    expect(config.features.holeFormatBoost).toBe(false);
    expect(readMorisConfig({ MORIS_HOLE_FORMAT_BOOST_ENABLED: 'true' }).features.holeFormatBoost).toBe(true);
  });
});

describe('userMessage — Moris nói tên định dạng khi có cơ sở (chỉ tham khảo)', () => {
  const base = { mode: 'MORIS_VECTOR_SUGGESTIONS', candidates: [{ code: '3446950001' }], decision: { reasons: [] } };

  it('có khớp: nêu tên định dạng + số mã cùng định dạng', () => {
    const msg = buildMorisUserMessage({ ...base, hole_format_evidence: { query_tags: ['dai'], matched_count: 2 } });
    expect(msg).toContain('Định dạng lỗ tham chiếu: Lỗ dài');
    expect(msg).toContain('2 mã có mô tả cùng định dạng (chỉ để tham khảo).');
  });

  it('không mã nào khớp: vẫn nêu định dạng và nói rõ vẫn xếp theo tương đồng ảnh', () => {
    const msg = buildMorisUserMessage({ ...base, hole_format_evidence: { query_tags: ['oval', 'dai'], matched_count: 0 } });
    expect(msg).toContain('Lỗ oval, Lỗ dài');
    expect(msg).toContain('chưa có mã nào có mô tả cùng định dạng');
  });

  it('không có evidence → câu trả lời giữ nguyên như cũ', () => {
    expect(buildMorisUserMessage(base)).not.toContain('Định dạng lỗ');
  });

  it('không có ứng viên → noMatch, không thêm ghi chú định dạng', () => {
    const msg = buildMorisUserMessage({ mode: 'MORIS_VECTOR_NO_MATCH', candidates: [] });
    expect(msg).toBe(MORIS_PUBLIC_MESSAGES.noMatch);
  });
});
