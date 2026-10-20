import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('Mẫu lỗ phổ biến — menu + trang tra cứu (chủ dự án chốt 2026-10-19)', () => {
  const html = read('index.html');
  const app = read('src/app.js');

  it('menu nằm trong "Danh sách thao tác", ngay dưới Quản lý người dùng, mọi user thấy', () => {
    const navStart = html.indexOf('<!-- Danh sách thao tác -->');
    const navEnd = html.indexOf('<p class="nav-label mt-4">Tài khoản</p>');
    expect(navStart).toBeGreaterThan(-1);
    expect(navEnd).toBeGreaterThan(navStart);
    const nav = html.slice(navStart, navEnd);

    const userBtn = nav.indexOf('Quản lý người dùng');
    const holeBtn = nav.indexOf('Mẫu lỗ phổ biến');
    expect(userBtn).toBeGreaterThan(-1);
    expect(holeBtn).toBeGreaterThan(userBtn);

    const btnStart = nav.lastIndexOf('<button', holeBtn);
    const btnEnd = nav.indexOf('</button>', holeBtn);
    expect(btnStart).toBeGreaterThan(-1);
    const btn = nav.slice(btnStart, btnEnd + '</button>'.length);
    expect(btn).toContain('openHoleSamples()');
    expect(btn).toContain('closeNav()');
    expect(btn).toContain('Tra cứu định dạng lỗ theo ảnh mẫu');
    // Mọi user đã đăng nhập — không gate theo role như Quản lý người dùng.
    expect(btn).not.toContain('v-if="isAdmin"');
    expect(btn).not.toContain("v-if=\"session.user?.role_name === 'admin'\"");
  });

  it('trang là full-screen, KHÔNG modal, chỉ có header "Mẫu lỗ phổ biến" + list ảnh kèm tên', () => {
    const start = html.indexOf('MẪU LỖ PHỔ BIẾN');
    const end = html.indexOf('QUẢN LÝ NGƯỜI DÙNG');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = html.slice(start, end);

    expect(section).toContain('v-if="holeSamples.open"');
    expect(section).toContain('fixed inset-0');
    expect(section).toContain('Mẫu lỗ phổ biến');
    expect(section).toContain('@click="closeHoleSamples()"');
    // Không phải modal: không có modal-shell / modal-backdrop (Quản lý người dùng mới là modal).
    expect(section).not.toContain('modal-shell');
    // Chỉ ảnh + tên lỗ: không phơi thêm bất kỳ trường dữ liệu nào khác.
    expect(section).toContain(':src="holeSamplesUrl(s)"');
    expect(section).toContain('{{ s.name }}');
    for (const field of ['s.slug', 's.r2_key', 's.format_tag', 's.sort_order', 's.id']) {
      expect(section).not.toContain(`{{ ${field} }}`);
    }
  });

  it('app.js: state holeSamples + methods open/close/load/url đúng nguồn dữ liệu', () => {
    expect(app).toContain('holeSamples:{ open:false, loading:false, error:\'\', items:[] }');
    expect(app).toContain('openHoleSamples()');
    expect(app).toContain('closeHoleSamples()');
    expect(app).toContain('async loadHoleSamples()');
    expect(app).toContain('holeSamplesUrl(sample)');

    const loader = app.slice(app.indexOf('async loadHoleSamples()'), app.indexOf('holeSamplesUrl(sample)'));
    expect(loader).toContain(".from('moris_hole_samples')");
    expect(loader).toContain(".eq('active', true)");
    expect(loader).toContain(".order('sort_order', { ascending: true })");
    expect(loader).toContain("'id,slug,name,format_tag,r2_key,sort_order'");
  });
});

describe('Migration + R2 contract — từ điển mẫu lỗ', () => {
  const migrationPath = 'supabase/migrations/20261019180000_catalogue_hole_samples.sql';

  it('migration tồn tại với bảng, RLS authenticated read-only và 14 seed mẫu', () => {
    expect(existsSync(join(ROOT, migrationPath))).toBe(true);
    const sql = read(migrationPath);

    expect(sql).toContain('create table if not exists public.moris_hole_samples');
    expect(sql).toContain('slug       text not null unique');
    expect(sql).toContain('format_tag text not null');
    expect(sql).toContain('r2_key     text not null unique');
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('for select to authenticated using (true)');
    expect(sql).not.toContain('for insert to authenticated');
    expect(sql).not.toContain('for update to authenticated');
    expect(sql).not.toContain('for delete to authenticated');

    const seeds = sql.match(/\('(?:[a-z0-9-]+)',\s+'[^']+',\s+'[a-z_]+',\s+'hole-samples\/[a-z0-9-]+\.png',\s+\d+\)/g) || [];
    expect(seeds.length).toBe(14);
    for (const tag of ['tron', 'vuong', 'oval', 'oval_cong', 'dai', 'chu_nhat', 'chu_l', 'tam_giac', 'rang_cua', 'gai_moc']) {
      expect(sql).toContain(`'${tag}'`);
    }
  });

  it('sort_order đúng thứ tự nhóm định dạng chủ dự án chốt', () => {
    const sql = read(migrationPath);
    const order = [...sql.matchAll(/\('([a-z0-9-]+)',\s+'[^']+',\s+'[a-z_]+',\s+'hole-samples\/[a-z0-9-]+\.png',\s+(\d+)\)/g)]
      .map((m) => [m[1], Number(m[2])]);
    expect(order.map(([slug]) => slug)).toEqual([
      'tron', 'vuong', 'vuong-1', 'oval', 'oval-1', 'oval-cong',
      'dai', 'dai-1', 'dai-2', 'chu-nhat', 'chu-l', 'tam-giac', 'rang-cua', 'gai-moc'
    ]);
    const sorts = order.map(([, s]) => s);
    for (let i = 1; i < sorts.length; i++) expect(sorts[i]).toBeGreaterThan(sorts[i - 1]);
    expect(sorts[0]).toBe(10);
    expect(sorts[sorts.length - 1]).toBe(100);
  });

  it('thư mục Simple/ đủ 15 ảnh nguồn (11 định dạng sau khi gom biến thể)', () => {
    const dir = join(ROOT, 'Simple');
    expect(existsSync(dir)).toBe(true);
    const { readdirSync } = require('node:fs');
    const pngs = readdirSync(dir).filter((f) => /\.png$/i.test(f));
    expect(pngs.length).toBe(15);
    const bases = new Set(pngs.map((f) => f.replace(/\.png$/i, '').replace(/\s*\(\d+\)$/, '').toLowerCase()));
    expect(bases.size).toBe(11);
    for (const name of ['lỗ tròn', 'lỗ vuông', 'lỗ oval', 'lỗ oval cong', 'lỗ bán oval', 'lỗ dài', 'lỗ chữ nhật', 'lỗ chữ l', 'lỗ tam giác', 'lỗ răng cưa', 'lỗ gài móc']) {
      expect(bases.has(name)).toBe(true);
    }
  });
});

describe('Migration bổ sung — Lỗ bán oval (chủ dự án chốt 2026-10-20)', () => {
  const migrationPath = 'supabase/migrations/20261020072401_hole_sample_ban_oval.sql';

  it('thêm đúng 1 mẫu ban_oval idempotent, không đổi schema/RLS', () => {
    expect(existsSync(join(ROOT, migrationPath))).toBe(true);
    const sql = read(migrationPath);

    expect(sql).toContain("('ban-oval', 'Lỗ bán oval', 'ban_oval', 'hole-samples/ban-oval.png', 45)");
    expect(sql).toContain('on conflict (slug) do update set');
    expect(sql).not.toContain('create policy');
    expect(sql).not.toContain('enable row level security');

    const seeds = sql.match(/\('(?:[a-z0-9-]+)',\s+'[^']+',\s+'[a-z_]+',\s+'hole-samples\/[a-z0-9-]+\.png',\s+\d+\)/g) || [];
    expect(seeds.length).toBe(1);
  });

  it('sort_order 45 nằm giữa oval cong (40) và dài (51)', () => {
    const sql = read(migrationPath);
    expect(sql).toMatch(/'ban_oval'[\s\S]*45/);
    const base = read('supabase/migrations/20261019180000_catalogue_hole_samples.sql');
    expect(base).toMatch(/\('oval-cong',\s+'Lỗ oval cong',\s+'oval_cong',\s+'hole-samples\/oval-cong\.png',\s+40\)/);
    expect(base).toMatch(/\('dai',\s+'Lỗ dài',\s+'dai',\s+'hole-samples\/dai\.png',\s+51\)/);
  });
});
