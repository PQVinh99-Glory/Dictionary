// =======================================================================
// PHIÊN BẢN HỆ THỐNG — CATALOGUE AI
// =======================================================================
// Quy tắc đặt phiên bản theo chỉ định (Semantic Versioning):
// - Phiên bản hiện tại: Version 6.1.1
// - Sửa lỗi nhỏ không thêm tính năng: Tăng số cuối (+0.0.1) -> Ví dụ 6.1.2
// - Thêm tính năng mới vẫn tương thích bản cũ: Sửa số giữa (+0.1.0) -> Ví dụ 6.2.0
// - Thay đổi lớn có thể không tương thích: Thay đổi số đầu (+1.0.0) -> Ví dụ 7.0.0
// =======================================================================

const APP_VERSION = '6.1.2';
const APP_NAME = 'Catalogue';

/**
 * Phân tích chuỗi phiên bản thành [major, minor, patch]
 */
function parseVersion(v) {
  const parts = String(v || '').trim().replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return [parts[0], parts[1], parts[2]];
}

/**
 * So sánh 2 phiên bản:
 * Trả về: > 0 nếu a > b, < 0 nếu a < b, 0 nếu bằng nhau
 */
function compareVersions(a, b) {
  const [ma, na, pa] = parseVersion(a);
  const [mb, nb, pb] = parseVersion(b);
  if (ma !== mb) return ma - mb;
  if (na !== nb) return na - nb;
  return pa - pb;
}

/**
 * Tăng số cuối (patch +0.0.1) cho sửa lỗi nhỏ
 */
function bumpPatch(v = APP_VERSION) {
  const [m, n, p] = parseVersion(v);
  return `${m}.${n}.${p + 1}`;
}

/**
 * Tăng số giữa (minor +0.1.0) cho tính năng mới tương thích
 */
function bumpMinor(v = APP_VERSION) {
  const [m, n] = parseVersion(v);
  return `${m}.${n + 1}.0`;
}

/**
 * Tăng số đầu (major +1.0.0) cho thay đổi lớn có thể không tương thích
 */
function bumpMajor(v = APP_VERSION) {
  const [m] = parseVersion(v);
  return `${m + 1}.0.0`;
}

// Hỗ trợ cả môi trường Browser, Service Worker (self) và Node.js / Vitest
if (typeof self !== 'undefined') {
  self.APP_VERSION = APP_VERSION;
  self.APP_NAME = APP_NAME;
}
if (typeof window !== 'undefined') {
  window.APP_VERSION = APP_VERSION;
  window.APP_NAME = APP_NAME;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    APP_VERSION,
    APP_NAME,
    parseVersion,
    compareVersions,
    bumpPatch,
    bumpMinor,
    bumpMajor
  };
}
