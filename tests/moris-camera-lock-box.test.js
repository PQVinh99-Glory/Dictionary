import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// M27 (bổ sung 2026-10-19): khung vuông tracking nhận diện vật thể — helper
// chuẩn hoá bbox + reset state + ghim markup overlay trong index.html.
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

const { methods } = loadApp();

describe('M27 tracking box — subjectBoxToPercent', () => {
  it('bbox hợp lệ -> % theo vùng phân tích (bao gồm +1 pixel biên)', () => {
    expect(methods.subjectBoxToPercent.call({}, { x0: 10, y0: 20, x1: 59, y1: 99 }, 100, 200))
      .toEqual({ left: 10, top: 10, width: 50, height: 40 });
  });

  it('clamp biên âm/vượt khung', () => {
    expect(methods.subjectBoxToPercent.call({}, { x0: -5, y0: -3, x1: 150, y1: 250 }, 100, 200))
      .toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('thiếu dữ liệu / bbox rỗng / đảo cạnh -> null', () => {
    expect(methods.subjectBoxToPercent.call({}, null, 100, 200)).toBeNull();
    expect(methods.subjectBoxToPercent.call({}, { x0: 1, y0: 1, x1: 2, y1: 2 }, 0, 0)).toBeNull();
    expect(methods.subjectBoxToPercent.call({}, { x0: 50, y0: 10, x1: 40, y1: 90 }, 100, 200)).toBeNull();
  });

  it('smoothBoxView: target null -> null; chưa có prev -> snap đúng target', () => {
    expect(methods.smoothBoxView.call({}, null, null, 16, 150)).toBeNull();
    const target = { left: 10, top: 5, width: 20.5, height: 30 };
    expect(methods.smoothBoxView.call({}, null, target, 16, 150)).toEqual(target);
  });

  it('smoothBoxView: EMA hội tụ dần về target, làm tròn 2 chữ số, dt=0 giữ nguyên', () => {
    const prev = { left: 0, top: 0, width: 0, height: 0 };
    const target = { left: 100, top: 100, width: 100, height: 100 };
    const mid = methods.smoothBoxView.call({}, prev, target, 150, 150);
    expect(mid.left).toBeCloseTo(63.21, 2);
    expect(mid.width).toBeCloseTo(63.21, 2);
    expect(methods.smoothBoxView.call({}, prev, target, 0, 150)).toEqual(prev);
    const near = methods.smoothBoxView.call({}, { left: 99.9, top: 99.9, width: 99.9, height: 99.9 }, target, 600, 150);
    expect(near.left).toBeCloseTo(100, 1);
  });

  it('resetCameraLock xoá box cùng toàn bộ trạng thái lock', () => {
    const ctx = {
      camera: {
        lock: {
          enabled: true, seed: { fx: 0.5, fy: 0.5 }, ready: true,
          box: { left: 10, top: 10, width: 20, height: 20 },
          checks: {}, guidance: [], chips: [], stableCount: 3, samples: 3,
          agreement: 0.9, evidence: {}, evidenceSummary: 'x', lastError: ''
        }
      },
      stopCameraLockLoop: vi.fn()
    };
    methods.resetCameraLock.call(ctx);
    expect(ctx.camera.lock.box).toBeNull();
    expect(ctx.camera.lock.seed).toBeNull();
    expect(ctx.camera.lock.ready).toBe(false);
  });
});

describe('index.html — overlay khung vuông tracking', () => {
  const html = readFileSync('index.html', 'utf8');

  it('overlay bám camera.lock.box với 2 trạng thái nhận diện + không chặn tap', () => {
    expect(html).toContain('camera.lock.box');
    expect(html).toContain('Đang bám vật thể');
    expect(html).toContain('Đã nhận diện');
    const idx = html.indexOf('camera.lock.box');
    const block = html.slice(Math.max(0, idx - 200), idx + 700);
    expect(block).toContain('pointer-events-none');
  });

  it('overlay dùng ref cho vòng rAF 60fps, viền mảnh 1.5px, không transition layout', () => {
    const idx = html.indexOf('camera.lock.box');
    const block = html.slice(Math.max(0, idx - 200), idx + 700);
    expect(block).toContain('ref="camLockBox"');
    expect(block).toContain('border-[1.5px]');
    expect(block).not.toContain('transition-all');
  });
});

describe('index.html — text hướng dẫn camera mới (2026-10-19, chủ dự án yêu cầu)', () => {
  const html = readFileSync('index.html', 'utf8');

  it('câu hướng dẫn + nhãn tiến trình mới thay thế câu cũ', () => {
    expect(html).toContain('Điều chỉnh camera sao cho khung tracking vừa khớp chủ thể');
    expect(html).toContain('Đang quét, tái tạo vector và nhận diện vật thể...');
    expect(html).toContain('Giữ trọn vật thể trong khung camera trên nền TRẮNG');
    expect(html).toContain('Chờ tracking khóa chủ thể trong khung vàng rồi chụp.');
    expect(html).toContain('nếu không tìm ra bằng tracking hãy bấm "Tải ảnh từ máy"');
    expect(html).toContain('Nhập chiều dài để Harness sàng lọc chuẩn hơn');
    expect(html).not.toContain('Căn vật thể vừa khung tròn nét');
    expect(html).not.toContain('phân tích AI 3 lớp');
    expect(html).not.toContain('Đang nhận diện AI... Chuyển vào chat Moris');
  });

  it('ô size camera nhập được (bỏ disabled) + tag đỏ cảnh báo nhập size', () => {
    expect(html).toContain('@input="setCameraSizeUnknown(false)"');
    expect(html).not.toContain(':disabled="camera.size.unknown"');
    expect(html).toContain('Nhập size để tăng tỷ lệ sàng lọc');
    const idx = html.indexOf('cameraSizeNeedsInput');
    expect(idx).toBeGreaterThan(-1);
    const block = html.slice(idx, idx + 400);
    expect(block).toContain('bg-red-50');
  });
});

describe('P02 — camera landscape dùng toàn bộ frame', () => {
  it('tap ở 25% khung map tới 25% frame sensor và bỏ qua letterbox', () => {
    const video={videoWidth:1920,videoHeight:1080,getBoundingClientRect:()=>({left:0,top:0,width:1600,height:900})};
    const ctx={camera:{ready:true,busy:false,scanning:false,lock:{stableCount:3,samples:3,agreement:.9}},$refs:{camVideo:video}};
    methods.handleCameraTap.call(ctx,{clientX:400,clientY:450});
    expect(ctx.camera.lock.seed).toEqual({fx:.25,fy:.5});
    expect(ctx.camera.lock.stableCount).toBe(0);
  });

  it('video lấy aspect ratio thật và yêu cầu reset tracker khi đổi kích thước', () => {
    const ctx={camera:{frameAspect:'16 / 9',ready:false},$refs:{camVideo:{videoWidth:1280,videoHeight:960}},resetCameraLock:vi.fn()};
    methods.updateCameraFrameAspect.call(ctx);
    expect(ctx.camera.frameAspect).toBe('1280 / 960');
    expect(ctx.resetCameraLock).toHaveBeenCalledOnce();
  });

  it('UI camera mở rộng landscape, video không crop bằng object-fit cover', () => {
    const html=readFileSync('index.html','utf8');
    expect(html).toContain('max-w-6xl');
    expect(html).toContain('aspectRatio: camera.frameAspect');
    expect(html).toContain('style="object-fit:contain;"');
    expect(html).toContain('Xoay ngang điện thoại');
    expect(html).not.toContain('aspect-ratio:1000/410');
  });

  it('nút chụp bị khóa khi chưa tracking trọn vật hoặc máy còn dọc', () => {
    const html=readFileSync('index.html','utf8');
    expect(html).toContain('camera.landscapeHint || (camera.lock.enabled && !camera.lock.ready)');
    const ctx={
      camera:{ready:true,busy:false,scanning:false,landscapeHint:false,lock:{ready:false,guidance:['Lùi máy']}},
      $refs:{camVideo:{videoWidth:1920,videoHeight:1080}},toast:vi.fn()
    };
    methods.captureCamera.call(ctx);
    expect(ctx.toast).toHaveBeenCalledWith('warning','Lùi máy');
    expect(ctx.camera.busy).toBe(false);
  });
});

describe('Auto-capture khi tracking thành công báo xanh', () => {
  it('tự động gọi captureCamera khi tracking đạt readiness (báo xanh)', async () => {
    const mockModule = {
      analyzeFrame: vi.fn(() => ({
        mask: new Uint8Array(100),
        stats: { partPixels: 50, bbox: { x0: 10, y0: 10, x1: 40, y1: 40 } }
      })),
      toGray: vi.fn(() => new Uint8Array(100)),
      laplacianVariance: vi.fn(() => 15),
      maskIoU: vi.fn(() => 0.95),
      voteMasks: vi.fn(() => ({ agreement: 0.95 })),
      computeReadiness: vi.fn(() => ({
        ready: true,
        checks: { inFrame: true, singleSubject: true, stable: true, lowSpecular: true, sharp: true },
        guidance: []
      }))
    };

    const ctx = {
      camera: {
        open: true,
        ready: true,
        busy: false,
        scanning: false,
        landscapeHint: false,
        lock: { ready: false, checks: {}, guidance: [], chips: [], stableCount: 3, box: null }
      },
      _camLockMasks: [new Uint8Array(100), new Uint8Array(100), new Uint8Array(100)],
      _camLockDims: { w: 500, h: 281 },
      _camLockLastMask: new Uint8Array(100),
      $refs: {
        camVideo: { videoWidth: 1280, videoHeight: 720 }
      },
      loadSubjectLockModule: vi.fn(async () => mockModule),
      subjectBoxToPercent: vi.fn(() => ({ left: 10, top: 10, width: 20, height: 20 })),
      captureCamera: vi.fn(async () => {}),
      $nextTick: (fn) => fn(),
      readError: (e) => String(e?.message || e)
    };

    const mockCtx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(500 * 281 * 4) })) };
    ctx._camLockCanvas = { width: 0, height: 0, getContext: () => mockCtx };

    await methods._sampleCameraLockFrame.call(ctx);

    expect(ctx.camera.lock.ready).toBe(true);
    expect(ctx.captureCamera).toHaveBeenCalledOnce();
  });

  it('không tự động chụp nếu tracking chưa đạt readiness (chưa báo xanh)', async () => {
    const mockModule = {
      analyzeFrame: vi.fn(() => ({
        mask: new Uint8Array(100),
        stats: { partPixels: 50, bbox: { x0: 10, y0: 10, x1: 40, y1: 40 } }
      })),
      toGray: vi.fn(() => new Uint8Array(100)),
      laplacianVariance: vi.fn(() => 5),
      maskIoU: vi.fn(() => 0.5),
      voteMasks: vi.fn(() => ({ agreement: 0.6 })),
      computeReadiness: vi.fn(() => ({
        ready: false,
        checks: { inFrame: true, singleSubject: true, stable: false, lowSpecular: true, sharp: false },
        guidance: ['Giữ máy ổn định']
      }))
    };

    const ctx = {
      camera: {
        open: true,
        ready: true,
        busy: false,
        scanning: false,
        landscapeHint: false,
        lock: { ready: false, checks: {}, guidance: [], chips: [], stableCount: 0, box: null }
      },
      $refs: {
        camVideo: { videoWidth: 1280, videoHeight: 720 }
      },
      loadSubjectLockModule: vi.fn(async () => mockModule),
      subjectBoxToPercent: vi.fn(() => ({ left: 10, top: 10, width: 20, height: 20 })),
      captureCamera: vi.fn(async () => {}),
      $nextTick: (fn) => fn(),
      readError: (e) => String(e?.message || e)
    };

    const mockCtx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(500 * 281 * 4) })) };
    ctx._camLockCanvas = { width: 0, height: 0, getContext: () => mockCtx };

    await methods._sampleCameraLockFrame.call(ctx);

    expect(ctx.camera.lock.ready).toBe(false);
    expect(ctx.captureCamera).not.toHaveBeenCalled();
  });

  it('không tự động chụp nếu camera còn đang ở chiều dọc (landscapeHint = true)', async () => {
    const mockModule = {
      analyzeFrame: vi.fn(() => ({
        mask: new Uint8Array(100),
        stats: { partPixels: 50, bbox: { x0: 10, y0: 10, x1: 40, y1: 40 } }
      })),
      toGray: vi.fn(() => new Uint8Array(100)),
      laplacianVariance: vi.fn(() => 15),
      computeReadiness: vi.fn(() => ({
        ready: true,
        checks: { inFrame: true, singleSubject: true, stable: true, lowSpecular: true, sharp: true },
        guidance: []
      }))
    };

    const ctx = {
      camera: {
        open: true,
        ready: true,
        busy: false,
        scanning: false,
        landscapeHint: true,
        lock: { ready: false, checks: {}, guidance: [], chips: [], stableCount: 3, box: null }
      },
      $refs: {
        camVideo: { videoWidth: 1280, videoHeight: 720 }
      },
      loadSubjectLockModule: vi.fn(async () => mockModule),
      subjectBoxToPercent: vi.fn(() => ({ left: 10, top: 10, width: 20, height: 20 })),
      captureCamera: vi.fn(async () => {}),
      $nextTick: (fn) => fn(),
      readError: (e) => String(e?.message || e)
    };

    const mockCtx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(500 * 281 * 4) })) };
    ctx._camLockCanvas = { width: 0, height: 0, getContext: () => mockCtx };

    await methods._sampleCameraLockFrame.call(ctx);

    expect(ctx.camera.lock.ready).toBe(true);
    expect(ctx.captureCamera).not.toHaveBeenCalled();
  });
});
