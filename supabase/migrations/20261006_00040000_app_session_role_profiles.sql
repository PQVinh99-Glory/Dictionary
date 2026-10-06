-- ============================================================================
-- 20261006_00040000_app_session_role_profiles.sql
--
-- VẤN ĐỀ: app_session_role() chỉ đọc app_users.
--   - Đường JWT (Supabase Auth): uid = profiles.id  -> KHÔNG có trong app_users
--     -> trả NULL -> mọi hàm admin đều UNAUTHORIZED kể cả khi đã đăng nhập.
--   - Đường token cũ (app_sessions): uid = app_users.id -> vẫn đúng.
--
-- GIẢI PHÁP: đọc profiles trước (nguồn danh tính mới), fallback app_users
--            trong giai đoạn chuyển đổi để token cũ KHÔNG bị vỡ.
--            Sau khi drop app_users thì xoá nhánh fallback này.
--
-- CHỮ KÝ GIỮ NGUYÊN (p_session_token text) -> không sửa được hàm nào khác.
-- ============================================================================

create or replace function public.app_session_role(p_session_token text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_uid  uuid := public.app_session_user_id(p_session_token);
  v_role text;
begin
  if v_uid is null then
    return null;
  end if;

  -- 1) Nguồn mới: Supabase Auth -> profiles
  select p.role_name
  into v_role
  from public.profiles p
  where p.id = v_uid
    and p.is_active = true
  limit 1;

  if v_role is not null then
    return v_role;
  end if;

  -- 2) Fallback token cũ -> app_users.
  --    XOÁ Khối này sau khi drop table app_users.
  select u.role_name
  into v_role
  from public.app_users u
  where u.id = v_uid
    and u.is_active = true
  limit 1;

  return v_role;
end;
$$;

comment on function public.app_session_role(text) is
  'Vai trò theo token/JWT. Đọc profiles trước, fallback app_users khi còn bảng cũ.';
