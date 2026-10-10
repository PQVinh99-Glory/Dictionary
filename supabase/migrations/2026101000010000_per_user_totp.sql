-- =============================================================================
-- Migration: 2026101000010000_per_user_totp.sql
-- 
-- 1. Thêm cột totp_secret, totp_enabled vào bảng public.user_security
-- 2. Seed Secret Key mặc định cho admin và tự sinh cho các user hiện có
-- 3. Cập nhật hàm app_admin_list_profiles trả về username, totp_secret, totp_enabled
-- 4. Thêm hàm app_admin_reset_totp để admin cấp lại mã 2FA cho user
-- =============================================================================

begin;

-- 1. Thêm cột vào user_security
alter table public.user_security
  add column if not exists totp_secret text,
  add column if not exists totp_enabled boolean not null default true;

-- Hàm hỗ trợ sinh ngẫu nhiên Base32
create or replace function public.gen_random_base32(len int default 32)
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  result text := '';
  i int;
begin
  for i in 1..len loop
    result := result || substr(chars, floor(random() * 32 + 1)::int, 1);
  end loop;
  return result;
end;
$$;

-- Đảm bảo tất cả user hiện có trong profiles đều có bản ghi user_security
insert into public.user_security (user_id, totp_secret, totp_enabled)
select p.id, public.gen_random_base32(32), true
from public.profiles p
where not exists (select 1 from public.user_security s where s.user_id = p.id)
on conflict (user_id) do nothing;

-- Admin hệ thống gán khóa mặc định hiện tại để app Authenticator của admin không bị gián đoạn
update public.user_security
   set totp_secret = 'WHG4HAKRX3FNXOVLNOW6H2WWUKDRWWR5',
       totp_enabled = true
 where user_id in (
   select id from public.profiles where lower(email) = lower('pquangvinh1999@gmail.com')
 );

-- Điền khóa cho các user còn null
update public.user_security
   set totp_secret = public.gen_random_base32(32)
 where totp_secret is null;

-- 2. Cập nhật app_admin_list_profiles
drop function if exists public.app_admin_list_profiles(text);

create or replace function public.app_admin_list_profiles(p_session_token text)
returns table (
  user_id uuid,
  email text,
  display_name text,
  username text,
  role_name text,
  is_active boolean,
  failed_count integer,
  locked_until timestamptz,
  permanent_lock boolean,
  must_reset boolean,
  last_login_at timestamptz,
  totp_secret text,
  totp_enabled boolean
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
    p.username,
    p.role_name,
    p.is_active,
    coalesce(s.failed_count, 0),
    s.locked_until,
    coalesce(s.permanent_lock, false),
    coalesce(s.must_reset, false),
    s.last_login_at,
    s.totp_secret,
    coalesce(s.totp_enabled, true)
  from public.profiles p
  left join public.user_security s on s.user_id = p.id
  where public.app_session_role(p_session_token) = 'admin'
  order by p.role_name, p.email;
$$;

grant execute on function public.app_admin_list_profiles(text) to authenticated;
grant execute on function public.app_admin_list_profiles(text) to service_role;

-- 3. Hàm admin reset mã 2FA
create or replace function public.app_admin_reset_totp(
  p_session_token text,
  p_user_id uuid,
  p_new_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_secret text;
begin
  if public.app_session_role(p_session_token) <> 'admin' then
    return jsonb_build_object('ok', false, 'message', 'Chỉ admin mới được cấp lại 2FA.');
  end if;

  v_secret := coalesce(p_new_secret, public.gen_random_base32(32));

  insert into public.user_security (user_id, totp_secret, totp_enabled, updated_at)
  values (p_user_id, v_secret, true, now())
  on conflict (user_id) do update
    set totp_secret = v_secret,
        totp_enabled = true,
        updated_at = now();

  return jsonb_build_object('ok', true, 'totp_secret', v_secret);
end;
$$;

grant execute on function public.app_admin_reset_totp(text, uuid, text) to authenticated;
grant execute on function public.app_admin_reset_totp(text, uuid, text) to service_role;

commit;
