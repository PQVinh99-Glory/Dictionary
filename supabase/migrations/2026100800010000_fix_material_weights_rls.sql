-- =============================================================================
-- Migration: 2026100800010000_fix_material_weights_rls.sql
-- 
-- Thắt chặt RLS cho bảng material_weights:
-- - Viewer: chỉ được SELECT (đọc đơn trọng để hiển thị/tính toán nếu cần)
-- - Converter & Admin: toàn quyền INSERT / UPDATE / DELETE đơn trọng
-- - Anon: từ chối mọi quyền
-- =============================================================================

begin;

-- Đảm bảo RLS luôn bật
alter table public.material_weights enable row level security;

-- 1. SELECT: Cho phép tất cả user đã đăng nhập
drop policy if exists mw_select on public.material_weights;
create policy mw_select on public.material_weights
  for select to authenticated
  using (true);

-- 2. INSERT: Chỉ role 'converter' hoặc 'admin'
drop policy if exists mw_insert on public.material_weights;
create policy mw_insert on public.material_weights
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role_name in ('converter', 'admin')
        and p.is_active = true
    )
  );

-- 3. UPDATE: Chỉ role 'converter' hoặc 'admin'
drop policy if exists mw_update on public.material_weights;
create policy mw_update on public.material_weights
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role_name in ('converter', 'admin')
        and p.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role_name in ('converter', 'admin')
        and p.is_active = true
    )
  );

-- 4. DELETE: Chỉ role 'converter' hoặc 'admin'
drop policy if exists mw_delete on public.material_weights;
create policy mw_delete on public.material_weights
  for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role_name in ('converter', 'admin')
        and p.is_active = true
    )
  );

commit;
