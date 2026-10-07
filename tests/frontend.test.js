import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }

describe('build-static — allowlist, không rò secret', () => {
  it('npm run build chạy được và chỉ copy allowlist', () => {
    execFileSync(process.execPath, ['tools/build-static.mjs'], { cwd: ROOT, stdio: 'pipe' });

    for (const entry of [
      'dist/index.html',
      'dist/config.js',
      'dist/src/app.js',
      'dist/assets/icon-book.png',
      'dist/tools/moris-vector-center.html',
      'dist/_headers'
    ]) {
      expect(existsSync(join(ROOT, entry)), `thiếu ${entry}`).toBe(true);
    }

    // TUYỆT ĐỐI không được đưa lên static hosting
    for (const forbidden of [
      'dist/.env', 'dist/.dev.vars', 'dist/functions', 'dist/supabase',
      'dist/kim-harness', 'dist/node_modules', 'dist/package.json',
      'dist/package-lock.json', 'dist/tests'
    ]) {
      expect(existsSync(join(ROOT, forbidden)), `không được có ${forbidden}`).toBe(false);
    }
  });

  it('config.js công khai không chứa key nhạy cảm', () => {
    const cfg = read('dist/config.js');
    expect(cfg).toMatch(/MORIS_PUBLIC_CONFIG/);
    for (const bad of ['service_role', 'SERVICE_ROLE', 'SECRET_KEY', 'ADMIN_TOKEN', 'password']) {
      expect(cfg.includes(bad), `config.js không được chứa ${bad}`).toBe(false);
    }
  });

  it('dist/index.html = index.html nguồn (không sửa tay bản build)', () => {
    expect(read('dist/index.html')).toBe(read('index.html'));
    expect(read('dist/src/app.js')).toBe(read('src/app.js'));
  });
});

describe('index.html — cấu trúc template Vue', () => {
  const html = read('index.html');

  it('tất cả tag đều đóng đủ (không lệch div/button/...)', () => {
    const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'wbr', 'path', 'svg']);
    for (const tag of ['div', 'section', 'main', 'aside', 'button', 'header', 'form',
      'label', 'span', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'li', 'nav',
      'video', 'select', 'option', 'template', 'transition', 'a', 'p']) {
      const open = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
      const close = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
      if (VOID.has(tag)) continue;
      expect(open, `<${tag}> lệch: ${open} mở / ${close} đóng`).toBe(close);
    }
  });

  it('có đủ các thành phần theo yêu cầu giao diện', () => {
    for (const marker of [
      'assets/icon-book.png',          // icon sách đỏ (logo + favicon + drawer)
      'nav.open',                      // slide menu
      'openNav()',                     // nút mở slide menu
      'camera.open',                   // modal camera Moris
      'ref="camVideo"',                // video camera
      'vectorCenter.open',             // modal Vector AI (iframe)
      'users.open',                    // quản lý người dùng
      'ref="ledKg"',                   // LED ghi thẳng DOM
      'ref="ledPcs"',
      'wcScrollMax',                   // bảng đơn trọng cửa sổ ảo
      'wcImgActiveUrl',                // ảnh Catalogue trong modal Quy đổi
      'v-if="canEdit"',
      'canConvert'                     // phân quyền converter
    ]) {
      expect(html.includes(marker), `thiếu marker: ${marker}`).toBe(true);
    }
  });

  it('không còn nút thao tác nào render khi chưa đăng nhập', () => {
    // Nút thao tác phải nằm trong <main v-else> (chỉ hiện khi có session.user)
    const appStart = html.indexOf('<main v-else');
    expect(appStart).toBeGreaterThan(0);
    for (const marker of ['openNav()', 'openWeightCalc()', 'openUserManager()']) {
      expect(html.indexOf(marker)).toBeGreaterThan(appStart);
    }
  });

  it('favicon dùng ảnh sách đỏ, không còn data-URI SVG cũ', () => {
    expect(html).toMatch(/<link rel="icon" href="assets\/icon-book\.png"/);
    expect(html).not.toMatch(/rel="icon" href="data:image\/svg\+xml/);
  });
});

describe('src/app.js — phân quyền & phiên', () => {
  const js = read('src/app.js');

  it('node --check pass', () => {
    execFileSync(process.execPath, ['--check', 'src/app.js'], { cwd: ROOT, stdio: 'pipe' });
  });

  it('đúng 3 role, không còn hardcode role editor', () => {
    expect(js).not.toContain("['admin','editor']");
    expect(js).toContain("canEdit() { return this.role === 'admin'; }");
    expect(js).toContain("canConvert() { return this.role === 'admin' || this.role === 'converter'; }");
    expect(js).toContain("isAdmin() { return this.role === 'admin'; }");
    expect(js).toContain("role() { return String(this.session.user?.role_name || '').toLowerCase(); }");
  });

  it('mọi cửa sổ quyền đều báo đúng thông điệp', () => {
    const gates = js.match(/Bạn chưa được cấp quyền, liên hệ admin\./g) || [];
    expect(gates.length).toBeGreaterThanOrEqual(6);
    expect(js).not.toContain("'Tài khoản không có quyền.'");
  });

  it('đăng nhập đi qua /api/auth/login + giữ hạn phiên', () => {
    expect(js).toContain('CONFIG.LOGIN_URL');
    expect(js).toContain('setSessionExpiry');
    expect(js).toContain('guardSession');
    expect(js).toContain('SESSION_EXP_KEY');
    // Token KHÔNG được ghi vào storage
    expect(js).not.toMatch(/localStorage\.setItem\([^)]*(token|access_token)/);
  });

  it('đóng phiên dọn sạch state (không sót modal)', () => {
    for (const m of ['closeNav()', 'closeMoris()', 'closeWeightCalc()', 'closeVectorCenter()']) {
      expect(js.includes(m), `endSession phải gọi ${m}`).toBe(true);
    }
  });
});

describe('migration — 3 role + user_security', () => {
  const sql = read('supabase/migrations/2026100700010000_auth_roles_security.sql');

  it('khóa role đúng viewer/converter/admin', () => {
    expect(sql).toContain("check (role_name in ('viewer', 'converter', 'admin'))");
    expect(sql).toContain("role_name = 'editor'");
    expect(sql).toContain("set role_name = 'converter'");
  });

  it('tаблицu user_security bật RLS và chặn client', () => {
    expect(sql).toMatch(/create table if not exists public\.user_security/);
    expect(sql).toContain('alter table public.user_security enable row level security');
    expect(sql).toContain('revoke all on table public.user_security from authenticated');
    expect(sql).toContain('revoke all on table public.user_security from anon');
  });

  it('chỉ admin mới quản lý role/mở khóa/danh sách user', () => {
    for (const fn of ['app_admin_set_profile_role', 'app_admin_unlock_profile', 'app_admin_list_profiles']) {
      expect(sql, `thiếu ${fn}`).toContain(fn);
    }
    const roles = sql.match(/coalesce\(v_role, ''\) <> 'admin'/g) || [];
    expect(roles.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("public.app_session_role(p_session_token) = 'admin'");
  });
});
