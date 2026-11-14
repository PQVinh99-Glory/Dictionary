-- =============================================================================
-- Migration: 20261114000000_fix_profiles_recursion_weight_edit.sql
--
-- 1) Sửa lỗi "infinite recursion detected in policy for relation profiles":
--    policy profiles_select_admin tự truy vấn public.profiles trong chính nó.
--    Thay bằng helper SECURITY DEFINER app_current_role() đọc role 1 lần,
--    bypass RLS -> không còn đệ quy.
-- 2) Công cụ Quy đổi định lượng: mọi user đang hoạt động trừ viewer
--    được INSERT/UPDATE/DELETE đơn trọng (kg/pcs).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Helper đọc role hiện tại, bypass RLS profiles
-- ---------------------------------------------------------------------------
create or replace function public.app_current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role_name
    from public.profiles p
   where p.id = auth.uid()
     and p.is_active = true
   limit 1
$$;

revoke all on function public.app_current_role() from public;
revoke all on function public.app_current_role() from anon;
grant execute on function public.app_current_role() to authenticated;
grant execute on function public.app_current_role() to service_role;

comment on function public.app_current_role() is
  'Role của user đang đăng nhập (null nếu không có profile/inactive). SECURITY DEFINER để policy không đệ quy qua RLS profiles.';

-- ---------------------------------------------------------------------------
-- 2. Bỏ đệ quy policy profiles_select_admin
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.app_current_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 3. material_weights: mọi user trừ viewer được sửa đơn trọng
-- ---------------------------------------------------------------------------
alter table public.material_weights enable row level security;

drop policy if exists mw_insert on public.material_weights;
create policy mw_insert on public.material_weights
  for insert to authenticated
  with check (public.app_current_role() <> 'viewer');

drop policy if exists mw_update on public.material_weights;
create policy mw_update on public.material_weights
  for update to authenticated
  using (public.app_current_role() <> 'viewer')
  with check (public.app_current_role() <> 'viewer');

drop policy if exists mw_delete on public.material_weights;
create policy mw_delete on public.material_weights
  for delete to authenticated
  using (public.app_current_role() <> 'viewer');

commit;
