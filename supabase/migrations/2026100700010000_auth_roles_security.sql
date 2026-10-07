-- ============================================================================
-- 20261007_000100_auth_roles_security.sql
--
-- Task F — Hệ thống user/phân quyền của Catalogue Linh Kiện.
--
-- 1) Đúng 3 role: viewer / converter / admin (đổi role cũ 'editor' -> 'converter'):
--      viewer    : chỉ xem ảnh chi tiết (không sửa/xoá/không Quy đổi)
--      converter : viewer + toàn quyền modal Quy đổi (sửa/lưu/thêm đơn trọng)
--      admin     : toàn quyền app + quản lý user (đổi role, mở khóa,
--                  cấp lại mật khẩu). Admin KHÔNG tạo user mới
--                  (tạo qua Supabase Dashboard -> auth.users).
--
-- 2) Bảng user_security: chống dò mật khẩu + trạng thái khóa tài khoản.
--    Pages Function /api/auth/login là nơi DUY NHẤT ghi bảng này
--    (dùng service key). RLS tắt toàn bộ cho client.
--
--    Quy ước khóa:
--      1..4 lần sai   -> trả "Còn X lần thử"
--      lần thứ 5      -> khóa 1 giờ (hết hạn -> reset bộ đếm về 0)
--      lần thứ 7      -> khóa vĩnh viễn -> admin phải "cấp lại mật khẩu"
--
-- LƯU Ý: Supabase Auth (GoTrue) vẫn là nguồn xác thực mật khẩu.
--        Khóa tài khoản được thực thi tại Pages Function (app layer) —
--        người dùng không đi qua /api/auth/login thì không vào được app
--        vì app_me / profiles.is_active chặn ở tầng dữ liệu.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Role: viewer / converter / admin
-- ---------------------------------------------------------------------------
-- 1a. 'editor' (role cũ) -> 'converter'
update public.profiles
   set role_name = 'converter',
       updated_at = now()
 where role_name = 'editor';

-- 1b. Mọi role lạ/khác còn sót -> 'viewer' (tránh key CHECK fail)
update public.profiles
   set role_name = 'viewer',
       updated_at = now()
 where coalesce(role_name, '') not in ('viewer', 'converter', 'admin');

-- 1c. Xóa MỌI check constraint đang kiểm cột role_name.
--     Tên constraint cũ có thể khác nếu bảng được tạo tay trước khi có
--     migration 20261006_00010000 -> chỉ drop 'if exists' một tên là chưa đủ.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid
       and att.attnum   = any (con.conkey)
     where con.conrelid = 'public.profiles'::regclass
       and con.contype  = 'c'
       and att.attname  = 'role_name'
    loop
      execute format('alter table public.profiles drop constraint %I', c.conname);
    end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role_name in ('viewer', 'converter', 'admin'));

comment on column public.profiles.role_name is
  'viewer: chỉ xem | converter: + Quy đổi | admin: toàn quyền + quản lý user';

-- ---------------------------------------------------------------------------
-- 2. user_security — bộ đếm sai mật khẩu / khóa tài khoản (service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.user_security (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  failed_count    integer not null default 0,
  locked_until    timestamptz,
  permanent_lock  boolean not null default false,
  must_reset      boolean not null default false,
  last_failure_at timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists user_security_locked_until_idx
  on public.user_security (locked_until)
  where locked_until is not null;

-- RLS: KHÔNG ai đọc/ghi từ client. Toàn bộ thao tác qua service key
-- (Pages Function) hoặc SECURITY DEFINER.
alter table public.user_security enable row level security;

drop policy if exists user_security_no_client on public.user_security;
-- (không tạo policy nào -> mọi role không qua service key đều bị từ chối)

revoke all on table public.user_security from public;
revoke all on table public.user_security from anon;
revoke all on table public.user_security from authenticated;
revoke all on table public.user_security from service_role;

grant select, insert, update on table public.user_security to service_role;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null then
    drop trigger if exists user_security_updated_at on public.user_security;
    create trigger user_security_updated_at
      before update on public.user_security
      for each row execute function public.set_updated_at();
  end if;
end $$;

comment on table public.user_security is
  'Chống dò mật khẩu: failed_count / locked_until / permanent_lock / must_reset. Chỉ Pages Function (service key) được ghi.';

-- ---------------------------------------------------------------------------
-- 3. Hàm admin: cập nhật role (dùng bởi Pages Function /api/auth/users
--    để mọi thay đổi đều đi qua SECURITY DEFINER có kiểm quyền admin).
--    App layer đã có validateSession -> app_me -> app_session_role.
-- ---------------------------------------------------------------------------
create or replace function public.app_admin_set_profile_role(
  p_session_token text,
  p_user_id uuid,
  p_role_name text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_role text := public.app_session_role(p_session_token);
  v_uid  uuid := public.app_session_user_id(p_session_token);
begin
  if coalesce(v_role, '') <> 'admin' then
    return jsonb_build_object('ok', false, 'message', 'Chỉ admin mới đổi được role.');
  end if;
  if p_role_name not in ('viewer', 'converter', 'admin') then
    return jsonb_build_object('ok', false, 'message', 'Role không hợp lệ.');
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'message', 'Thiếu user_id.');
  end if;

  update public.profiles
     set role_name = p_role_name, updated_at = now()
   where id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Không tìm thấy user.');
  end if;

  insert into public.user_security (user_id, updated_at)
  values (p_user_id, now())
  on conflict (user_id) do nothing;

  return jsonb_build_object('ok', true, 'role_name', p_role_name);
end;
$$;

grant execute on function public.app_admin_set_profile_role(text, uuid, text) to authenticated;
grant execute on function public.app_admin_set_profile_role(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Mở khóa + cấp lại mật khẩu trạng thái (không đổi mật khẩu — GoTrue lo)
-- ---------------------------------------------------------------------------
create or replace function public.app_admin_unlock_profile(
  p_session_token text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_role text := public.app_session_role(p_session_token);
begin
  if coalesce(v_role, '') <> 'admin' then
    return jsonb_build_object('ok', false, 'message', 'Chỉ admin mới mở khóa.');
  end if;

  update public.user_security
     set failed_count = 0,
         locked_until = null,
         permanent_lock = false,
         must_reset = false,
         updated_at = now()
   where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'message', 'Đã mở khóa tài khoản.');
end;
$$;

grant execute on function public.app_admin_unlock_profile(text, uuid) to authenticated;
grant execute on function public.app_admin_unlock_profile(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Danh sách user cho panel admin (profiles + trạng thái khóa)
-- ---------------------------------------------------------------------------
create or replace function public.app_admin_list_profiles(p_session_token text)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role_name text,
  is_active boolean,
  failed_count integer,
  locked_until timestamptz,
  permanent_lock boolean,
  must_reset boolean,
  last_login_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $$
  select
    p.id,
    p.email,
    split_part(coalesce(p.email, ''), '@', 1),
    p.role_name,
    p.is_active,
    coalesce(s.failed_count, 0),
    s.locked_until,
    coalesce(s.permanent_lock, false),
    coalesce(s.must_reset, false),
    s.last_login_at
  from public.profiles p
  left join public.user_security s on s.user_id = p.id
  where public.app_session_role(p_session_token) = 'admin'
  order by p.role_name, p.email;
$$;

grant execute on function public.app_admin_list_profiles(text) to authenticated;
grant execute on function public.app_admin_list_profiles(text) to service_role;

commit;
