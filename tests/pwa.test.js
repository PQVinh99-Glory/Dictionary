import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function read(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }

describe('PWA & Versioning — Đặc tả và cấu hình', () => {
  it('manifest.webmanifest hợp lệ và trỏ đúng các icon đã tạo', () => {
    expect(existsSync(join(ROOT, 'manifest.webmanifest'))).toBe(true);
    const manifest = JSON.parse(read('manifest.webmanifest'));
    expect(manifest.name).toBe('Catalogue Linh Kiện');
    expect(manifest.short_name).toBe('Catalogue');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#7F011F');
    expect(manifest.background_color).toBe('#F5EBD0');

    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(4);

    for (const icon of manifest.icons) {
      const relPath = icon.src.replace(/^\//, '');
      expect(existsSync(join(ROOT, relPath)), `File icon ${relPath} phải tồn tại`).toBe(true);
    }
  });

  it('src/version.js — phiên bản hiện tại là 6.1.3 và tuân thủ quy tắc tăng phiên bản', async () => {
    const versionMod = await import('../src/version.js');
    expect(versionMod.APP_VERSION).toBe('6.1.3');

    // Quy tắc người dùng yêu cầu:
    // 1) Sửa lỗi nhỏ không thêm tính năng: tăng số cuối 0.0.1
    expect(versionMod.bumpPatch('6.1.3')).toBe('6.1.4');
    expect(versionMod.bumpPatch('6.1.9')).toBe('6.1.10');

    // 2) Thêm tính năng mới vẫn tương thích bản cũ: sửa số giữa 0.1.0
    expect(versionMod.bumpMinor('6.1.3')).toBe('6.2.0');

    // 3) Thay đổi lớn có thể không tương thích: thay đổi số đầu 1.0.0
    expect(versionMod.bumpMajor('6.1.3')).toBe('7.0.0');

    // So sánh phiên bản
    expect(versionMod.compareVersions('6.1.4', '6.1.3')).toBeGreaterThan(0);
    expect(versionMod.compareVersions('6.2.0', '6.1.5')).toBeGreaterThan(0);
    expect(versionMod.compareVersions('6.1.3', '6.1.3')).toBe(0);
  });

  it('version.json tại root và dist khớp với phiên bản 6.1.3', () => {
    const rootVer = JSON.parse(read('version.json'));
    expect(rootVer.version).toBe('6.1.3');
    if (existsSync(join(ROOT, 'dist/version.json'))) {
      const distVer = JSON.parse(read('dist/version.json'));
      expect(distVer.version).toBe('6.1.3');
      expect(distVer.name).toBe('Catalogue');
    }
  });

  it('sw.js — đảm bảo cache thông minh, xóa cache cũ và hỗ trợ SKIP_WAITING / CLEAR_CACHE', () => {
    const sw = read('sw.js');
    // Versioned cache keys
    expect(sw).toContain('catalogue-static-v');
    expect(sw).toContain('catalogue-media-v');
    // SKIP_WAITING & CLEAR_CACHE
    expect(sw).toContain('SKIP_WAITING');
    expect(sw).toContain('skipWaiting()');
    expect(sw).toContain('CLEAR_CACHE');
    // Xóa cache cũ khi activate
    expect(sw).toContain('caches.delete(key)');
    expect(sw).toContain('clients.claim()');
    // Không bao giờ cache API & Auth
    expect(sw).toContain('/api/');
    // /config.js và /version.json lấy tươi từ mạng (no-store)
    expect(sw).toContain('/config.js');
    expect(sw).toContain('/version.json');
    // Navigation là Network-First
    expect(sw).toContain("mode === 'navigate'");
    // Protocol guard cho data/blob scheme
    expect(sw).toContain("url.protocol.startsWith('http')");
  });

  it('index.html có đầy đủ thẻ PWA trong head, nút Tải App, Xóa cache, Floating Toast và Modal Hướng dẫn', () => {
    const html = read('index.html');
    // Thẻ head PWA
    expect(html).toContain('href="/manifest.webmanifest"');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('theme-color');

    // Nút "Tải App" đặt cạnh "Catalogue Linh Kiện"
    expect(html).toContain('Tải App');
    expect(html).toContain('togglePwaPanel()');

    // Panel Tải App gồm 1 nút Tải xuống và 1 nút Xóa cache
    expect(html).toContain('pwaInstall()');
    expect(html).toContain('Tải xuống');
    expect(html).toContain('pwaClearCache()');
    expect(html).toContain('Xóa cache');

    // Floating Toast toàn hệ thống (z-[9999])
    expect(html).toContain('z-[9999]');

    // Modal Hướng dẫn Cài đặt PWA
    expect(html).toContain('pwa.guideOpen');
    expect(html).toContain('openPwaModal()');
    expect(html).toContain('Cài Đặt Catalogue');

    // Mục "Phiên bản" tự hiện khi phát hiện bản mới
    expect(html).toContain('pwa.version');
    expect(html).toContain('Phiên bản');
    expect(html).toContain('pwa.updateReady');
    expect(html).toContain('Cập nhật ngay');
    expect(html).toContain('pwaApplyUpdate()');

    // Nạp version.js trước app.js
    const posVer = html.indexOf('/src/version.js');
    const posApp = html.indexOf('/src/app.js');
    expect(posVer).toBeGreaterThan(0);
    expect(posApp).toBeGreaterThan(posVer);
  });

  it('src/app.js bắt beforeinstallprompt sớm và hỗ trợ openPwaModal', () => {
    const app = read('src/app.js');
    expect(app).toContain('_globalInstallPrompt');
    expect(app).toContain('openPwaModal()');
    expect(app).toContain('CLEAR_CACHE');
  });

  it('_headers cấu hình no-cache cho sw.js và version.json', () => {
    const headers = read('_headers');
    expect(headers).toContain('/sw.js');
    expect(headers).toContain('/version.json');
    expect(headers).toContain('/manifest.webmanifest');
  });

  it('dist/ chứa đầy đủ các file PWA sau khi build', () => {
    expect(existsSync(join(ROOT, 'dist/manifest.webmanifest'))).toBe(true);
    expect(existsSync(join(ROOT, 'dist/sw.js'))).toBe(true);
    expect(existsSync(join(ROOT, 'dist/version.json'))).toBe(true);
    expect(existsSync(join(ROOT, 'dist/src/version.js'))).toBe(true);
    expect(existsSync(join(ROOT, 'dist/assets/icon-192.png'))).toBe(true);
    expect(existsSync(join(ROOT, 'dist/assets/icon-512.png'))).toBe(true);
    expect(existsSync(join(ROOT, 'dist/assets/icon-512-maskable.png'))).toBe(true);
    expect(existsSync(join(ROOT, 'dist/assets/apple-touch-icon.png'))).toBe(true);
  });
});
