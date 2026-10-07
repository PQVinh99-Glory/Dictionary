-- =============================================================================
-- Migration 0005: Drop app_users / app_sessions, dọn dead code
-- =============================================================================
-- Điều kiện tiên quyết (đã verify trước khi chạy):
--   * 6 RPC frontend dùng là: app_me, app_search_catalogue, app_get_part_assets,
--     app_upsert_part_metadata, app_replace_part_assets, app_delete_part
--     -> không có hàm nào trong danh sách DROP.
--   * Hàm giữ không tham chiếu app_admin_* / app_login / app_change_password / app_logout.
--   * 3 cột FK trỏ VÀO app_users đều NULL hoàn toàn:
--       image_library.created_by_user_id  0/50 non-null
--       image_library.updated_by_user_id  0/50 non-null
--       app_audit_log.user_id             0/0   non-null
--     => retarget sang profiles(id) không mất dữ liệu.
--   * Backup: /tmp/opencode/backup/20261006_app_users.json (9 user),
--     20261006_app_sessions.json, 20261006_app_functions.sql (22 hàm).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) app_session_user_id: CHỈ nhận diện qua Supabase Auth (auth.jwt()->>'sub').
--    Bỏ nhánh token opaque cũ vì bảng app_sessions sắp bị drop.
-- -----------------------------------------------------------------------------
create or replace function public.app_session_user_id(p_session_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_sub text;
  v_uid uuid;
begin
  v_sub := auth.jwt() ->> 'sub';

  if v_sub is null then
    return null;
  end if;

  begin
    v_uid := v_sub::uuid;
  exception when others then
    return null;
  end;

  if exists (
    select 1 from public.profiles
    where id = v_uid
      and is_active = true
  ) then
    return v_uid;
  end if;

  return null;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 2) app_session_role: bỏ fallback đọc app_users.
-- -----------------------------------------------------------------------------
create or replace function public.app_session_role(p_session_token text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_uid  uuid := public.app_session_user_id(p_session_token);
  v_role text;
begin
  if v_uid is null then
    return null;
  end if;

  select p.role_name
  into v_role
  from public.profiles p
  where p.id = v_uid
    and p.is_active = true
  limit 1;

  return v_role;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 3) Retarget 3 FK đang trỏ vào app_users -> profiles (cả 3 cột đều NULL).
-- -----------------------------------------------------------------------------
alter table public.image_library
  drop constraint if exists image_library_created_by_user_id_fkey;
alter table public.image_library
  add constraint image_library_created_by_user_id_fkey
  foreign key (created_by_user_id) references public.profiles(id) on delete set null;

alter table public.image_library
  drop constraint if exists image_library_updated_by_user_id_fkey;
alter table public.image_library
  add constraint image_library_updated_by_user_id_fkey
  foreign key (updated_by_user_id) references public.profiles(id) on delete set null;

alter table public.app_audit_log
  drop constraint if exists app_audit_log_user_id_fkey;
alter table public.app_audit_log
  add constraint app_audit_log_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 4) Xoá dead code: 8 hàm không trang nào gọi.
-- -----------------------------------------------------------------------------
drop function if exists public.app_admin_list_users(text);
drop function if exists public.app_admin_set_user_role(text, text, text);
drop function if exists public.app_admin_set_user_active(text, text, boolean);
drop function if exists public.app_admin_reset_password(text, text, text);
drop function if exists public.app_admin_audit_log(text, integer);
drop function if exists public.app_login(text, text);
drop function if exists public.app_change_password(text, text, text);
drop function if exists public.app_logout(text);

-- -----------------------------------------------------------------------------
-- 5) Drop bảng legacy. app_sessions FK sang app_users nên drop trước.
-- -----------------------------------------------------------------------------
drop table if exists public.app_sessions;
drop table if exists public.app_users;

