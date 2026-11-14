import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = 'supabase/migrations/20261114000000_fix_profiles_recursion_weight_edit.sql';
const sql = readFileSync(join(ROOT, MIGRATION), 'utf8');

describe('migration — sửa đệ quy RLS profiles & quyền sửa đơn trọng', () => {
  it('helper app_current_role là SECURITY DEFINER, đọc profile active', () => {
    expect(sql).toContain('create or replace function public.app_current_role()');
    expect(sql).toContain('security definer');
    expect(sql).toContain('where p.id = auth.uid()');
    expect(sql).toContain('and p.is_active = true');
  });

  it('profiles_select_admin không còn tự truy vấn public.profiles', () => {
    const start = sql.indexOf('create policy profiles_select_admin');
    const end = sql.indexOf(';', start);
    const policy = sql.slice(start, end);
    expect(policy).toContain("public.app_current_role() = 'admin'");
    expect(policy).not.toContain('from public.profiles');
  });

  it('mọi role trừ viewer được insert/update/delete material_weights', () => {
    expect(sql).toMatch(/create policy mw_insert[\s\S]*?with check \(public\.app_current_role\(\) <> 'viewer'\)/);
    expect(sql).toMatch(/create policy mw_update[\s\S]*?using \(public\.app_current_role\(\) <> 'viewer'\)[\s\S]*?with check \(public\.app_current_role\(\) <> 'viewer'\)/);
    expect(sql).toMatch(/create policy mw_delete[\s\S]*?using \(public\.app_current_role\(\) <> 'viewer'\)/);
    // Viewer bị từ chối qua so sánh trực tiếp, không dùng subquery profiles (tránh đệ quy RLS)
    expect(sql).not.toMatch(/create policy mw_(insert|update|delete)[\s\S]*?from public\.profiles/);
  });
});
