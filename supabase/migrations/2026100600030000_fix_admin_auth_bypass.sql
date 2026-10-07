-- ============================================================================
-- 20261006_00030000_fix_admin_auth_bypass.sql
--
-- LỖ HỔNG NGHIÊM TRỌNG (có sẵn từ trước, không phải do migration đổi auth):
--   if public.app_session_role(p_session_token) <> 'admin' then
--     raise exception 'UNAUTHORIZED';
--   end if;
--
--   Khi token rác/không đăng nhập -> app_session_role() trả NULL
--   -> NULL <> 'admin' = NULL (không phải TRUE)
--   -> if không chạy -> KHÔNG raise -> bypass toàn bộ kiểm quyền admin.
--
-- BẰNG CHỨNG đã tái hiện trên DB thật (KHÔNG đăng nhập, dùng anon key):
--   app_admin_list_users      -> trả danh sách 9 user       (phải là 401)
--   app_admin_reset_password  -> "Không tìm thấy user"      (phải là 401)
--   app_admin_set_user_role   -> "Đã cập nhật quyền"       (đã đổi Na -> admin)
--   (đã khôi phục Na -> viewer, khớp backup 100%)
--
-- CÁCH SỬA: '<>'  ->  'is distinct from'
--   NULL is distinct from 'admin' = TRUE  -> raise đúng.
--
-- SỐ CHỖ SỬA: 5/5 (đã quét toàn bộ function SECURITY DEFINER trong public)
-- ============================================================================

-- app_admin_audit_log: sửa 1 chỗ
CREATE OR REPLACE FUNCTION public.app_admin_audit_log(p_session_token text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id bigint, user_display_name text, action_name text, target_table text, target_id text, detail jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if public.app_session_role(p_session_token) is distinct from 'admin' then
    raise exception 'UNAUTHORIZED';
  end if;

  return query
  select
    l.id,
    u.display_name,
    l.action_name,
    l.target_table,
    l.target_id,
    l.detail,
    l.created_at
  from public.app_audit_log l
  left join public.app_users u on u.id = l.user_id
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$function$;


-- app_admin_list_users: sửa 1 chỗ
CREATE OR REPLACE FUNCTION public.app_admin_list_users(p_session_token text)
 RETURNS TABLE(id uuid, username text, display_name text, role_name text, is_active boolean, must_change_password boolean, failed_login_count integer, locked_until timestamp with time zone, last_login_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if public.app_session_role(p_session_token) is distinct from 'admin' then
    raise exception 'UNAUTHORIZED';
  end if;

  return query
  select
    u.id,
    u.username,
    u.display_name,
    u.role_name,
    u.is_active,
    u.must_change_password,
    u.failed_login_count,
    u.locked_until,
    u.last_login_at,
    u.created_at,
    u.updated_at
  from public.app_users u
  order by
    case when u.display_name = 'Vinh' then 0 else 1 end,
    u.display_name;
end;
$function$;


-- app_admin_reset_password: sửa 1 chỗ
CREATE OR REPLACE FUNCTION public.app_admin_reset_password(p_session_token text, p_username text, p_new_password text)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_admin_id uuid;
  v_target_id uuid;
begin
  v_admin_id := public.app_session_user_id(p_session_token);

  if public.app_session_role(p_session_token) is distinct from 'admin' then
    raise exception 'UNAUTHORIZED';
  end if;

  if length(coalesce(p_new_password, '')) < 10 then
    return query select false, 'Mật khẩu mới cần tối thiểu 10 ký tự';
    return;
  end if;

  select id
  into v_target_id
  from public.app_users
  where lower(username) = lower(trim(p_username))
  limit 1;

  if v_target_id is null then
    return query select false, 'Không tìm thấy user';
    return;
  end if;

  update public.app_users
  set
    password_hash = crypt(p_new_password, gen_salt('bf', 12)),
    must_change_password = true,
    failed_login_count = 0,
    locked_until = null,
    updated_at = now()
  where id = v_target_id;

  update public.app_sessions
  set revoked_at = now()
  where user_id = v_target_id
    and revoked_at is null;

  insert into public.app_audit_log(user_id, action_name, target_table, target_id)
  values (
    v_admin_id,
    'ADMIN_RESET_PASSWORD',
    'app_users',
    v_target_id::text
  );

  return query select true, 'Đã reset mật khẩu';
end;
$function$;


-- app_admin_set_user_active: sửa 1 chỗ
CREATE OR REPLACE FUNCTION public.app_admin_set_user_active(p_session_token text, p_username text, p_is_active boolean)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_admin_id uuid;
begin
  v_admin_id := public.app_session_user_id(p_session_token);

  if public.app_session_role(p_session_token) is distinct from 'admin' then
    raise exception 'UNAUTHORIZED';
  end if;

  update public.app_users
  set is_active = p_is_active, updated_at = now()
  where lower(username) = lower(trim(p_username));

  insert into public.app_audit_log(user_id, action_name, target_table, target_id, detail)
  values (
    v_admin_id,
    'ADMIN_SET_USER_ACTIVE',
    'app_users',
    p_username,
    jsonb_build_object('is_active', p_is_active)
  );

  return query select true, 'Đã cập nhật trạng thái user';
end;
$function$;


-- app_admin_set_user_role: sửa 1 chỗ
CREATE OR REPLACE FUNCTION public.app_admin_set_user_role(p_session_token text, p_username text, p_role_name text)
 RETURNS TABLE(ok boolean, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_admin_id uuid;
begin
  v_admin_id := public.app_session_user_id(p_session_token);

  if public.app_session_role(p_session_token) is distinct from 'admin' then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_role_name not in ('admin', 'editor', 'viewer') then
    return query select false, 'Role không hợp lệ';
    return;
  end if;

  update public.app_users
  set role_name = p_role_name, updated_at = now()
  where lower(username) = lower(trim(p_username));

  insert into public.app_audit_log(user_id, action_name, target_table, target_id, detail)
  values (
    v_admin_id,
    'ADMIN_SET_USER_ROLE',
    'app_users',
    p_username,
    jsonb_build_object('role_name', p_role_name)
  );

  return query select true, 'Đã cập nhật quyền';
end;
$function$;


