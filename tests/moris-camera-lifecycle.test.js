import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function cameraMethods({ getUserMedia, document, screen, windowOverrides } = {}) {
  let options;
  const win = { addEventListener: vi.fn(), removeEventListener: vi.fn(), ...windowOverrides };
  vm.runInNewContext(readFileSync('src/app.js', 'utf8'), {
    Vue: { createApp(o) { options = o; return { mount() {} }; } },
    window: win,
    navigator: { mediaDevices: { getUserMedia } },
    document: document || {},
    screen: screen || {},
    atob,
    console,
    setTimeout,
    clearTimeout
  });
  return { methods: options.methods, win };
}

function context(methods, video) {
  const ctx = {
    camera: { open: true, ready: false, busy: false, scanning: false, error: '', previewUrl: '', maskUrl: '', scanStatus: '', lock: {} },
    $refs: { camVideo: video },
    resetCameraLock: vi.fn(),
    startCameraLockLoop: vi.fn(),
    stopCameraLockLoop: vi.fn(),
    readError: e => String(e?.message || e)
  };
  ctx.stopCameraStream = () => methods.stopCameraStream.call(ctx);
  return ctx;
}

describe('P02 camera lifecycle across browser permission and orientation races', () => {
  it('closes a pending getUserMedia request without reviving the camera or leaking tracks', async () => {
    const pending = deferred();
    const track = { stop: vi.fn(), getSettings: () => ({ width: 1920 }) };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const { methods } = cameraMethods({ getUserMedia: () => pending.promise });
    const video = { srcObject: null, play: vi.fn().mockResolvedValue() };
    const ctx = context(methods, video);
    const started = methods.startCameraStream.call(ctx);
    methods.closeCamera.call(ctx);
    pending.resolve(stream);
    await started;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(ctx.camera.ready).toBe(false);
    expect(video.srcObject).toBeNull();
    expect(ctx.startCameraLockLoop).not.toHaveBeenCalled();
  });

  it('resets prior tracking on a new stream and waits for video playback before ready', async () => {
    const pendingPlay = deferred();
    const track = { stop: vi.fn(), getSettings: () => ({ width: 1280, height: 720 }) };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    const { methods } = cameraMethods({ getUserMedia: async () => stream });
    const video = { srcObject: null, videoWidth: 1280, videoHeight: 720, play: () => pendingPlay.promise };
    const ctx = context(methods, video);
    ctx.updateCameraFrameAspect = vi.fn();
    const started = methods.startCameraStream.call(ctx);
    await Promise.resolve();
    expect(ctx.resetCameraLock).toHaveBeenCalledOnce();
    expect(ctx.camera.ready).toBe(false);
    pendingPlay.resolve();
    await started;
    expect(ctx.camera.ready).toBe(true);
    expect(ctx.startCameraLockLoop).toHaveBeenCalledOnce();
  });

  it('does not lock orientation after fullscreen resolves following camera close', async () => {
    const entered = deferred();
    const doc = { fullscreenElement: null, documentElement: {} };
    doc.documentElement.requestFullscreen = () => entered.promise;
    doc.exitFullscreen = vi.fn(async () => { doc.fullscreenElement = null; });
    const lock = vi.fn(async () => {});
    const { methods } = cameraMethods({ document: doc, screen: { orientation: { lock } } });
    const ctx = { camera: { open: true }, _cameraOpenId: 1, updateCameraOrientation: vi.fn() };
    const requested = methods.requestCameraLandscape.call(ctx);
    ctx.camera.open = false;
    ctx._cameraOpenId++;
    doc.fullscreenElement = doc.documentElement;
    entered.resolve();
    await requested;
    expect(lock).not.toHaveBeenCalled();
    expect(doc.exitFullscreen).toHaveBeenCalledOnce();
  });

  it('keeps camera usable when Safari/Android rejects orientation lock', async () => {
    const lock = vi.fn().mockRejectedValue(new Error('unsupported'));
    const { methods } = cameraMethods({ screen: { orientation: { lock } } });
    const ctx = { camera: { open: true }, _cameraOpenId: 1, updateCameraOrientation: vi.fn() };
    await expect(methods.requestCameraLandscape.call(ctx)).resolves.toBeUndefined();
    expect(lock).toHaveBeenCalledWith('landscape');
    expect(ctx.camera.open).toBe(true);
  });

  it('releases camera stream and reports permission denial without marking ready', async () => {
    const error = Object.assign(new Error('permission denied'), { name: 'NotAllowedError' });
    const { methods } = cameraMethods({ getUserMedia: async () => { throw error; } });
    const ctx = context(methods, { srcObject: null });
    await methods.startCameraStream.call(ctx);
    expect(ctx.camera.ready).toBe(false);
    expect(ctx.camera.error).toContain('cho phép truy cập camera');
    expect(ctx.startCameraLockLoop).not.toHaveBeenCalled();
  });

  it('uses device orientation on a phone so opening the keyboard cannot masquerade as landscape', () => {
    const { methods, win } = cameraMethods({
      windowOverrides: {
        orientation: 0,
        innerWidth: 390,
        innerHeight: 300,
        matchMedia: () => ({ matches: true })
      }
    });
    const ctx = { camera: { landscapeHint: false } };
    methods.updateCameraOrientation.call(ctx);
    expect(ctx.camera.landscapeHint).toBe(true);
    win.orientation = 90;
    methods.updateCameraOrientation.call(ctx);
    expect(ctx.camera.landscapeHint).toBe(false);
  });

  it('keeps a locked subject while the keyboard resizes a landscape viewport', () => {
    const { methods, win } = cameraMethods({
      windowOverrides: {
        orientation: 90,
        innerWidth: 844,
        innerHeight: 390,
        matchMedia: () => ({ matches: true })
      }
    });
    const ctx = {
      camera: { open: false, ready: true },
      resetCameraLock: vi.fn(), resetCameraSize: vi.fn(),
      startCameraLockLoop: vi.fn(), startCameraStream: vi.fn(),
      requestCameraLandscape: vi.fn(),
      $nextTick: vi.fn()
    };
    ctx.updateCameraOrientation = () => methods.updateCameraOrientation.call(ctx);
    methods.openCamera.call(ctx);
    expect(ctx.resetCameraLock).toHaveBeenCalledTimes(1);
    win.innerHeight = 200;
    ctx._cameraOrientationHandler();
    expect(ctx.resetCameraLock).toHaveBeenCalledTimes(1);
    win.orientation = 0;
    ctx._cameraOrientationHandler();
    expect(ctx.resetCameraLock).toHaveBeenCalledTimes(2);
  });
});
