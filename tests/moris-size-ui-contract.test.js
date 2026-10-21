import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as sizeContract from '../src/moris/size-contract.js';

// T2 (sổ nợ 2026-10-17): test HÀNH VI cho panel M28 — nạp src/app.js thật trong
// vm (pattern tests/moris-catalogue-paging.test.js) rồi gọi trực tiếp các method.
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
  return { methods: options.methods, computed: options.computed };
}

function sizeCtx(size) {
  return { camera: { size: { length: '', width: '', unknown: true, ...size } } };
}

describe('M28 UI contract — panel nhập kích thước (hành vi thật từ src/app.js)', () => {
  const { methods, computed } = loadApp();

  it('setCameraSizeUnknown(false) khi gõ input: giữ giá trị, không còn unknown', () => {
    const ctx = sizeCtx({ unknown: true });
    methods.setCameraSizeUnknown.call(ctx, false);
    expect(ctx.camera.size.unknown).toBe(false);
  });

  it('setCameraSizeUnknown(true) xoá sạch cạnh đã nhập (fail-open bỏ qua lọc)', () => {
    const ctx = sizeCtx({ length: '120', width: '80', unknown: false });
    methods.setCameraSizeUnknown.call(ctx, true);
    expect(ctx.camera.size).toEqual({ length: '', width: '', unknown: true });
  });

  it('setCameraSizeUnknown chỉ nhận đúng boolean true, giá trị khác coi như false', () => {
    const ctx = sizeCtx({ unknown: true });
    methods.setCameraSizeUnknown.call(ctx, 'yes');
    expect(ctx.camera.size.unknown).toBe(false);
  });

  it('cameraSizeHint đổi trạng thái theo dữ liệu nhập (trống/sai/quá cỡ/hợp lệ/partial)', () => {
    const hint = (size) => computed.cameraSizeHint.call(sizeCtx(size));

    expect(hint({ unknown: true })).toBe('Không nhập = bỏ qua lọc kích thước');
    expect(hint({ unknown: false })).toBe('Nhập cạnh dài nhất (mm) — cạnh ngắn có thể để trống');
    expect(hint({ unknown: false, width: '80' })).toBe('Cần nhập cạnh dài nhất (mm) — cạnh ngắn có thể để trống');
    expect(hint({ unknown: false, length: '120' })).toBe('Lọc theo cạnh dài 120 mm (chưa có cạnh ngắn)');
    expect(hint({ unknown: false, length: '0', width: '80' })).toBe('Số đo phải lớn hơn 0');
    expect(hint({ unknown: false, length: '6000', width: '80' })).toBe('Số đo tối đa 5000mm');
    expect(hint({ unknown: false, length: '80', width: '120' })).toBe('Lọc theo 120 × 80 mm');
    expect(hint({ unknown: false, length: '80,5', width: '120' })).toBe('Lọc theo 120 × 80.5 mm');
  });

  it('cameraSizeNeedsInput: tag đỏ bật khi chưa có size dùng được, tắt khi đủ cạnh dài', () => {
    const flag = (size) => computed.cameraSizeNeedsInput.call(sizeCtx(size));
    expect(flag({ unknown: true })).toBe(true);
    expect(flag({ unknown: false, length: '', width: '' })).toBe(true);
    expect(flag({ unknown: false, length: 'abc', width: '' })).toBe(true);
    expect(flag({ unknown: false, length: '-5', width: '' })).toBe(true);
    expect(flag({ unknown: false, length: '120', width: '' })).toBe(false);
    expect(flag({ unknown: false, length: '120', width: '80' })).toBe(false);
    expect(flag({ unknown: false, length: '80,5', width: '' })).toBe(false);
  });

  it('readCameraSize: unknown/thiếu cạnh dài/sai/âm/quá cỡ -> null (server bỏ qua gate)', async () => {
    const cases = [
      { unknown: true },
      { unknown: false },
      { unknown: false, width: '80' },
      { unknown: false, length: 'abc', width: '80' },
      { unknown: false, length: '-5', width: '80' },
      { unknown: false, length: '6000', width: '80' }
    ];
    for (const size of cases) {
      const ctx = { ...sizeCtx(size), loadSizeContractModule: async () => sizeContract };
      expect(await methods.readCameraSize.call(ctx), JSON.stringify(size)).toBeNull();
    }
  });

  it('readCameraSize S1.1: chỉ cạnh dài -> payload partial (width_mm null), cạnh ngắn bỏ qua', async () => {
    const ctx = {
      ...sizeCtx({ unknown: false, length: '120', width: '' }),
      loadSizeContractModule: async () => sizeContract
    };
    expect(await methods.readCameraSize.call(ctx))
      .toEqual({ length_mm: 120, width_mm: null, source: 'user', confidence: 0.6 });

    const invalidWidth = {
      ...sizeCtx({ unknown: false, length: '120', width: '-5' }),
      loadSizeContractModule: async () => sizeContract
    };
    expect(await methods.readCameraSize.call(invalidWidth)).toBeNull();
  });

  it('readCameraSize: dùng module hợp đồng thật, tự hoán vị (L >= W) + payload chuẩn', async () => {
    const ctx = {
      ...sizeCtx({ unknown: false, length: '80', width: '120' }),
      loadSizeContractModule: async () => sizeContract
    };
    const payload = await methods.readCameraSize.call(ctx);
    expect(payload).toEqual({ length_mm: 120, width_mm: 80, source: 'user', confidence: 0.6 });
  });

  it('readCameraSize: chấp nhận dấu phẩy thập phân (80,5)', async () => {
    const ctx = {
      ...sizeCtx({ unknown: false, length: '80,5', width: '120,25' }),
      loadSizeContractModule: async () => sizeContract
    };
    const payload = await methods.readCameraSize.call(ctx);
    expect(payload.length_mm).toBe(120.25);
    expect(payload.width_mm).toBe(80.5);
  });

  it('readCameraSize: module lỗi -> fallback inline vẫn hoán vị đúng, không ném', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ctx = {
        ...sizeCtx({ unknown: false, length: '80', width: '120' }),
        loadSizeContractModule: async () => { throw new Error('offline'); }
      };
      expect(await methods.readCameraSize.call(ctx)).toEqual({
        length_mm: 120, width_mm: 80, source: 'user', confidence: 0.6
      });
      expect(warn).toHaveBeenCalled();

      const over = {
        ...sizeCtx({ unknown: false, length: '80', width: '9000' }),
        loadSizeContractModule: async () => { throw new Error('offline'); }
      };
      expect(await methods.readCameraSize.call(over)).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it('onCameraFileSelect truyền đủ 4 tham số sendMorisMessage (querySize là tham số 4)', async () => {
    const querySize = await (async () => {
      const ctx = {
        ...sizeCtx({ unknown: false, length: '120', width: '80' }),
        loadSizeContractModule: async () => sizeContract
      };
      return methods.readCameraSize.call(ctx);
    })();

    const run = async (expectedSize) => {
      const ctx = {
        camera: { busy: false, scanning: false, scanStatus: '', previewUrl: '', maskUrl: '', size: { length: '', width: '', unknown: true } },
        moris: { imageDataUrl: '', imagePreview: '', imageName: '', imageFile: null },
        stopCameraStream: vi.fn(),
        prepareMorisImage: async () => 'data:image/jpeg;base64,QUJD',
        validateMorisUploadDataUrl: vi.fn(async () => ({ verdict: { ready:true }, source_frame:{width:1280,height:720} })),
        buildMorisQueryVector: async () => ({ embedding: [0.1], probes: [], profile: 'cls_l2_v1' }),
        readCameraSize: async () => expectedSize,
        closeCamera: vi.fn(),
        openMoris: vi.fn(),
        sendMorisMessage: vi.fn(async () => {}),
        toast: vi.fn(),
        readError: (e) => String(e?.message || e)
      };
      const event = { target: { files: [{ name: 'part.jpg' }], value: 'x' } };
      await methods.onCameraFileSelect.call(ctx, event);
      expect(ctx.validateMorisUploadDataUrl).toHaveBeenCalledOnce();
      expect(ctx.sendMorisMessage).toHaveBeenCalledTimes(1);
      return ctx.sendMorisMessage.mock.calls[0];
    };

    const withSize = await run(querySize);
    expect(withSize[0]).toBeNull();
    expect(withSize[1]).toMatchObject({ profile: 'cls_l2_v1' });
    expect(withSize[2]).toBeNull();
    expect(withSize[3]).toEqual(querySize);

    const failOpen = await run(null);
    expect(failOpen[3]).toBeNull();
  });

  it('sendMorisMessage mode ảnh: body /api/moris/search chứa size từ tham số 4', async () => {
    const fetchWithTimeout = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, candidates: [] })
    }));
    const ctx = {
      moris: { busy: false, input: '', imageDataUrl: 'data:image/jpeg;base64,QUJD', messages: [], status: '' },
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
    const size = { length_mm: 120, width_mm: 80, source: 'user', confidence: 0.6 };

    await methods.sendMorisMessage.call(ctx, null, vectorResult, null, size);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    const [url, options] = fetchWithTimeout.mock.calls[0];
    expect(url).toBe('/api/moris/search');
    const body = JSON.parse(options.body);
    expect(body.size).toEqual(size);
    expect(body.image_data_url).toBe('data:image/jpeg;base64,QUJD');

    fetchWithTimeout.mockClear();
    ctx.moris.busy = false;
    ctx.moris.imageDataUrl = 'data:image/jpeg;base64,QUJD';
    await methods.sendMorisMessage.call(ctx, null, vectorResult, null);
    expect(JSON.parse(fetchWithTimeout.mock.calls[0][1].body).size).toBeNull();
  });
});
