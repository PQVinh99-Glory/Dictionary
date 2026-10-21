import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Từ điển mẫu lỗ (2026-10-19): hợp đồng UI thật từ src/app.js — payload hole_formats
// và tóm tắt bằng chứng camera (thêm nhãn "dài").
function loadApp() {
  let options;
  vm.runInNewContext(readFileSync('src/app.js', 'utf8'), {
    Vue: { createApp(o) { options = o; return { mount() {} }; } },
    window: { addEventListener() {} },
    atob,
    console,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {}
  });
  return { methods: options.methods };
}

describe('UI contract — payload hole_formats từ bằng chứng camera', () => {
  const { methods } = loadApp();

  it('morisHoleFormatsPayload: chỉ trả tag có đếm > 0, bỏ unknown', () => {
    const ctx = { moris: { captureEvidence: { reliable:true, holes: { counts: { circle: 2, square: 0, oval: 1, slot: 3, unknown: 4 } } } } };
    expect(methods.morisHoleFormatsPayload.call(ctx)).toEqual({ tron: 2, oval: 1, dai: 3 });
  });

  it('morisHoleFormatsPayload: không có bằng chứng / toàn unknown / toàn 0 -> null', () => {
    expect(methods.morisHoleFormatsPayload.call({ moris: {} })).toBeNull();
    expect(methods.morisHoleFormatsPayload.call({ moris: { captureEvidence: null } })).toBeNull();
    expect(methods.morisHoleFormatsPayload.call({ moris: { captureEvidence: { reliable:false, holes: { counts: { circle: 4 } } } } })).toBeNull();
    expect(methods.morisHoleFormatsPayload.call({ moris: { captureEvidence: { holes: { counts: { unknown: 5 } } } } })).toBeNull();
    expect(methods.morisHoleFormatsPayload.call({ moris: { captureEvidence: { holes: { counts: { circle: 0, slot: 0 } } } } })).toBeNull();
    expect(methods.morisHoleFormatsPayload.call({moris:{
      captureEvidence:{reliable:true,holes:{counts:{circle:4}}},
      captureQuality:{optical_consistency:{status:'mismatch'}}
    }})).toBeNull();
  });

  it('P04 chỉ báo hai segmentation bất đồng lỗ kín, không coi missing/unknown là 0', () => {
    const ctx={moris:{captureEvidence:{reliable:true,holes:{total:4,counts:{unknown:0}}}}};
    const vector={diagnostics:{maskQuality:{reliable:true}},geometry:{hole_count:2}};
    expect(methods.compareCaptureOpticalEvidence.call(ctx,vector)).toEqual({
      status:'mismatch',capture_closed_count:4,optical_closed_count:2
    });
    ctx.moris.captureEvidence.holes.counts.unknown=1;
    expect(methods.compareCaptureOpticalEvidence.call(ctx,vector).status).toBe('unknown');
    ctx.moris.captureEvidence=null;
    expect(methods.compareCaptureOpticalEvidence.call(ctx,vector).status).toBe('unknown');
  });

  it('sendMorisMessage mode ảnh: body /api/moris/search có hole_formats từ camera', async () => {
    const fetchWithTimeout = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, candidates: [] })
    }));
    const ctx = {
      moris: {
        busy: false, input: '', imageDataUrl: 'data:image/jpeg;base64,QUJD', messages: [], status: '',
        captureEvidence: { reliable:true, holes: { counts: { circle: 1, square: 0, oval: 0, slot: 2, unknown: 0 } } }
      },
      morisSearch: { queryId: null },
      filters: { usage: 'all', viewMode: 'all' },
      toast: vi.fn(),
      clearMorisSearch() {},
      scrollMorisToBottom: vi.fn(),
      freshAuth: async () => 'token',
      fetchWithTimeout,
      applyMorisSearchResults: vi.fn(),
      clearMorisImage: vi.fn(),
      morisPublicImageSearchError: (e) => String(e),
      morisHoleFormatsPayload: methods.morisHoleFormatsPayload,
      $nextTick: (fn) => { if (typeof fn === 'function') fn(); },
      renderIcons: vi.fn()
    };
    const vectorResult = { embedding: [0.1], probes: [], profile: 'cls_l2_v1', geometry: null };

    await methods.sendMorisMessage.call(ctx, null, vectorResult, null, null);
    const body = JSON.parse(fetchWithTimeout.mock.calls[0][1].body);
    expect(body.hole_formats).toEqual({ tron: 1, dai: 2 });

    fetchWithTimeout.mockClear();
    ctx.moris.captureEvidence = null;
    await methods.sendMorisMessage.call(ctx, null, vectorResult, null, null);
    const body2 = JSON.parse(fetchWithTimeout.mock.calls[0][1].body);
    expect(body2.hole_formats).toBeNull();
  });

  it('tóm tắt bằng chứng camera có nhãn "dài"', () => {
    const src = readFileSync('src/app.js', 'utf8');
    expect(src).toContain('parts.push(`${counts.slot} dài`)');
  });

  it('P09 UI giữ primary trước rescue dù rescue có điểm cao hơn',()=>{
    const ctx={
      moris:{imageDataUrl:'data:image/jpeg;base64,QUJD',messages:[]},
      morisSearch:{},
      morisCandidatePercent:methods.morisCandidatePercent
    };
    methods.applyMorisSearchResults.call(ctx,{candidates:[
      {id:'outside',selection_group:'rescue_outside',match_score:.99},
      {id:'primary',selection_group:'primary',match_score:.70},
      {id:'unknown',selection_group:'rescue_unknown',match_score:.95}
    ]});
    expect(ctx.morisSearch.ids).toEqual(['primary','unknown','outside']);
    expect(ctx.moris.messages[0].candidates.map(c=>c.id)).toEqual(ctx.morisSearch.ids);
  });
});
