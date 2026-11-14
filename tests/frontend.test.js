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
      'dist/src/moris/size-contract.js',
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
      'dist/package-lock.json', 'dist/tests',
      // mã nguồn .ts gốc không được lộ trong dist (chỉ .js đã build)
      'dist/src/moris/moris-idb.ts',
      'dist/src/moris/moris-layer1-optical.ts',
      'dist/src/moris/moris-layer2-embedding.ts',
      'dist/src/moris/moris-layer3-rerank.ts',
      'dist/src/moris/moris-worker-pipeline.ts'
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

  it('dist/index.html = index.html nguồn và dist/src/app.js được build sạch không còn comment', () => {
    expect(read('dist/index.html')).toBe(read('index.html'));
    expect(read('dist/src/app.js')).not.toContain('// CẤU HÌNH HỆ THỐNG');
    expect(read('dist/src/app.js')).toContain('MORIS_PUBLIC_CONFIG');
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
      'canConvert',                    // phân quyền converter
      'camera.lock.box',               // M27: khung vuông tracking vật thể
      'editor.form.size_length'        // M28 Gate D: 2 ô size trong editor
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
    expect(js).toContain("canConvert() { return !!this.role && this.role !== 'viewer'; }");
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

describe('yêu cầu mới — icon, tab Quy đổi, Vector AI, quản lý user', () => {
  const html = read('index.html');
  const js = read('src/app.js');
  const headers = read('_headers');

  it('icon sách đỏ: file nguồn assets/icon-book.png tồn tại (anh thay ảnh mới)', () => {
    expect(existsSync(join(ROOT, 'assets/icon-book.png'))).toBe(true);
    expect(html).toMatch(/<link rel="icon" href="assets\/icon-book\.png"/);
  });

  it('block "Ảnh Catalogue Linh Kiện" CHỈ hiện ở tab Quy đổi, ẩn ở tab Danh sách', () => {
    expect(html).toContain(`<div v-show="weightCalc.tab==='calc'" class="mt-6 bg-white/90`);
    // không còn block ảnh trần (không v-show) nằm ngoài 2 tab
    expect(html).not.toMatch(/<!-- =+ ẢNH CATALOGUE CỦA MÃ ĐANG QUY ĐỔI =+ -->\s*\n\s*<div class="mt-6/);
  });

  it('đã gỡ 3 dòng chữ theo yêu cầu', () => {
    expect(html).not.toContain('thư viện ảnh &amp; tra cứu');
    expect(html).not.toContain('Admin không tạo user mới');
    expect(html).not.toContain('Trợ lý nhận diện &amp; vector — chạy trong Catalogue');
  });

  it('Vector AI nhúng được: _headers cho phép same-origin, iframe bỏ hậu tố .html', () => {
    const starIdx = headers.indexOf('/*\n');
    const toolIdx = headers.indexOf('\n/tools/moris-vector-center\n');
    expect(starIdx).toBeGreaterThan(-1);
    expect(toolIdx).toBeGreaterThan(starIdx);          // rule cụ thể phải SAU rule /*
    const toolBlock = headers.slice(toolIdx);
    expect(toolBlock).toContain('X-Frame-Options: SAMEORIGIN');
    expect(toolBlock).toContain("frame-ancestors 'self'");
    expect(headers).toContain('/tools/moris-vector-center.html\n');

    expect(html).toContain('src="/tools/moris-vector-center"');
    expect(html).not.toContain('src="/tools/moris-vector-center.html"');
    expect(js).not.toContain("'/tools/moris-vector-center.html'");
  });

  it('Quy đổi + check trùng mã: gửi all/all, không còn p_usage_side rỗng', () => {
    expect(js).not.toContain("p_usage_side:''");
    expect(js).not.toContain("p_view_mode:''");
    expect((js.match(/p_usage_side:'all'/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((js.match(/p_view_mode:'all'/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('migration mới: profiles.username + app_search_catalogue coi "" = "all"', () => {
    const sql = read('supabase/migrations/2026100700020000_username_login_and_search_filters.sql');
    expect(sql).toContain('add column if not exists username text');
    expect(sql).toContain('profiles_username_uniq');
    expect(sql).toContain("nullif(trim(coalesce(p_usage_side, '')), '')");
    expect(sql).toContain("nullif(trim(coalesce(p_view_mode, '')), '')");
    expect(sql).toContain("v_usage = 'all' or i.usage_side = v_usage");
  });

  it('quản lý user: form thêm user + chặn admin hệ thống + modal đổi mật khẩu ở menu header', () => {
    expect(html).toContain('toggleUserCreate()');
    expect(html).toContain('createUser()');
    expect(html).toContain('isSystemAdmin(u)');
    expect(html).toContain('pwChange.open');
    expect(html).toContain('openPwChange()');

    expect(js).not.toContain('pquangvinh1999@gmail.com');
    expect(js).toContain('async submitPwChange()');
    expect(js).toContain('sb.auth.updateUser({ password: p.new })');
    // Admin hệ thống: chặn đủ 3 nhóm thao tác
    for (const a of ["set_role", "set_active", "set_inactive", "reset_password"]) {
      expect(js, `thiếu chặn ${a}`).toContain(a);
    }

    const be = read('functions/api/auth/users.js');
    expect(be).toContain('const SYSTEM_ADMIN_EMAIL = "pquangvinh1999@gmail.com";');
    expect(be).toContain('if (action === "create")');
    expect(be).toContain('SYNTHETIC_EMAIL_DOMAIN');
  });

  it('login nhận cả email lẫn tên đăng nhập (resolveLoginProfile)', () => {
    const authLib = read('functions/_lib/auth.js');
    const login = read('functions/api/auth/login.js');
    expect(authLib).toContain('export async function resolveLoginProfile');
    expect(login).toContain('resolveLoginProfile(env, loginInput)');
    expect(login).toContain('profile?.email || loginInput');
  });

  it('đã xóa dòng nhắc cuộn bảng khỏi DOM trong tab Danh sách quy đổi', () => {
    expect(html).not.toContain('Cuộn bảng để tải thêm mã, cuộn ngược để gỡ bớt khỏi DOM.');
    expect(html).toContain('Đang render {{ wcVisibleRows.length }} / {{ weightRows.length }} mã');
  });

  it('ảnh Catalogue trong modal Quy đổi: wcImgTypeUrl và wcImgFind là methods (không nằm trong computed)', () => {
    const methodsIdx = js.indexOf('methods:{');
    const wcTypeUrlIdx = js.indexOf('wcImgTypeUrl(type)');
    const wcFindIdx = js.indexOf('wcImgFind(type, order=1)');
    expect(methodsIdx).toBeGreaterThan(-1);
    expect(wcTypeUrlIdx).toBeGreaterThan(methodsIdx);
    expect(wcFindIdx).toBeGreaterThan(methodsIdx);
  });

  it('100% thông báo và xác nhận là UI nổi: không dùng native confirm(), có confirmModal và floating toast', () => {
    // Không dùng native confirm trong app.js
    expect(js).not.toMatch(/\bconfirm\(/);
    expect(js).toContain('showConfirm(');
    expect(js).toContain('confirmModal');

    // index.html có modal xác nhận nổi và floating toast
    expect(html).toContain('confirmModal.open');
    expect(html).toContain('confirmYes()');
    expect(html).toContain('confirmNo()');
    expect(html).toContain('z-[9999]');
  });

  it('form đăng nhập hỗ trợ đăng nhập bằng "Vinh" và admin display_name là "Vinh"', () => {
    expect(html).not.toContain('Vinh hoặc tên đăng nhập...');
    expect(html).toContain('placeholder="Tên đăng nhập..."');
    expect(js).toContain("me.display_name = 'Vinh'");
    expect(js).toContain("isSystemAdmin");
  });

  it('Client-Shield: ẩn console, chặn chuột phải, chặn phím F12/Ctrl+U/Ctrl+Shift+I và bẫy debugger', () => {
    expect(html).toContain('window.console.clear()');
    expect(html).toContain('configurable: false');
    expect(html).toContain('writable: false');
    expect(html).toContain('contextmenu');
    expect(html).toContain('F12');
    expect(html).toContain('debugger');
    expect(html).not.toContain('isDebug');
  });

  it('đã loại bỏ nút và modal Xóa tất cả ở giao diện main Catalogue', () => {
    // Không còn nút hoặc trigger executeDeleteAll() trên giao diện main
    expect(html).not.toContain('executeDeleteAll()');
    expect(html).not.toContain('Xóa tất cả</span>');
    // Vẫn bảo toàn nút Chọn hàng loạt cho Admin
    expect(html).toContain('toggleBulkSelectionMode()');
    expect(html).toContain('Chọn hàng loạt');
  });

  it('main Catalogue tích hợp bộ lọc đặc điểm nhận dạng theo cặp số + chữ và phân tách dấu phẩy', () => {
    expect(js).toContain('matchRowWithFeatures');
    expect(js).toContain('extractQueryFeatures');
    expect(js).toContain('isSingleFeatureMatch');
    expect(js).toContain('cleanFeatureText');
    expect(js).toContain('extractShapeKeyword');
  });

  it('main Catalogue tích hợp thanh filter mục tiêu: lọc ID và Mã linh kiện', () => {
    // Dropdown filters.target trong index.html
    expect(html).toContain('v-model="filters.target"');
    expect(html).toContain('Tất cả mục tiêu');
    expect(html).toContain('Mã linh kiện');
    expect(html).toContain('ID linh kiện');
    expect(html).toContain(':placeholder="searchPlaceholder"');

    // filters.target và searchPlaceholder trong src/app.js
    expect(js).toContain("target:'all'");
    expect(js).toContain('searchPlaceholder()');
    expect(js).toContain("targetMode === 'part_id'");
    expect(js).toContain("targetMode === 'code'");
  });

  it('đã loại bỏ tự động tách vector khi lưu thông tin linh kiện (savePart)', () => {
    // Flag cấu hình auto-on-save desktop & mobile đều tắt
    expect(js).toContain('MORIS_VECTOR_AUTO_ON_SAVE_DESKTOP: false');
    expect(js).toContain('MORIS_VECTOR_AUTO_ON_SAVE_MOBILE: false');

    // savePart() không còn gọi enqueueMorisVectorJob
    const savePartMatch = js.match(/async savePart\(\)\s*\{([\s\S]*?)\n\s*async deleteCurrentPart/);
    expect(savePartMatch).toBeTruthy();
    expect(savePartMatch[1]).not.toContain('enqueueMorisVectorJob');
    expect(savePartMatch[1]).not.toContain('processMorisVectorQueue');

    // M02: UI chỉ hướng dẫn mở Trung tâm Vector AI.
    expect(html).toContain('Lưu ảnh xong, mở Trung tâm Vector AI để tạo/cập nhật vector thủ công');
  });

  it('CSP trong _headers cho phép đa cấp Hugging Face CDN và XetHub storage', () => {
    const headers = read('_headers');
    expect(headers).toContain('https://*.huggingface.co');
    expect(headers).toContain('https://*.aws.cdn.hf.co');
    expect(headers).toContain('https://*.cdn.hf.co');
    expect(headers).toContain('https://*.xethub.com');
  });

  it('xử lý lỗi tải DINOv2 và cập nhật trạng thái UI rõ ràng thay vì treo', () => {
    expect(js).toContain("this.morisAi.statusText = 'Lỗi nạp'");
    expect(js).toContain('DINOV2_FETCH_FAILED');
    expect(js).toContain('chưa thể tải mô hình nhận dạng DINOv2 từ CDN (Failed to fetch)');
  });

  it('M28 Size Contract: panel nhập kích thước trong camera + payload size gửi server', () => {
    // index.html: panel cạnh dài/ngắn + nút "Không rõ kích thước" (fail-open)
    expect(html).toContain('camera.size.length');
    expect(html).toContain('camera.size.width');
    expect(html).toContain('setCameraSizeUnknown(true)');
    expect(html).toContain('cameraSizeHint');
    expect(html).toContain('Không rõ kích thước');

    // src/app.js: module hợp đồng size + đọc size + gửi kèm payload
    expect(js).toContain('MORIS_SIZE_CONTRACT_MODULE_URL');
    expect(js).toContain('async readCameraSize()');
    expect(js).toContain('size:querySize || null');
    expect(js).toContain("source: 'user'");

    // build-static: module được copy vào dist
    expect(existsSync(join(ROOT, 'dist/src/moris/size-contract.js'))).toBe(true);
    const distApp = read('dist/src/app.js');
    expect(distApp).toContain('size-contract.js');
  });
});



