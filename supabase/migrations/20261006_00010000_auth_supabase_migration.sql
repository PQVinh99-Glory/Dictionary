-- ============================================================================
-- 20261006_00010000_auth_supabase_migration.sql
--
-- MỤC TIÊU: chuyển đăng nhập từ bảng app_users/app_sessions sang Supabase Auth.
--
-- CHIẾN LƯỢC: chỉ thay THÂN hàm bản lề app_session_user_id().
-- Giữ nguyên chữ ký (p_session_token text) cho cả 22 hàm app_* →
-- không phải sửa frontend, không phải viết lại 20 hàm.
--
-- BẰNG CHỨNG: đã probe trên chính DB này —
--   auth.jwt() đọc được bên trong SECURITY DEFINER khi search_path bị hạn chế.
--   Có JWT      → {"sub":"8d091a3a-...","email":"pquangvinh1999@gmail.com"}
--   Không JWT   → {"sub":null,"email":null}
--
-- ROLLBACK: xem supabase/migrations/ROLLBACK_20261006.md
-- BACKUP:    /tmp/opencode/backup/20261006_app_functions.sql (22 hàm nguyên bản)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bảng profile: nối auth.users.id -> vai trò trong ứng dụng
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  role_name   text not null default 'viewer',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_role_check
    check (role_name in ('admin', 'editor', 'viewer'))
);

comment on table public.profiles is
  'Vai trò ứng dụng gắn với Supabase Auth. Nguồn danh tính duy nhất.';

create index if not exists profiles_role_idx
  on public.profiles (role_name) where is_active;

-- ---------------------------------------------------------------------------
-- 2. Tự đồng bộ profile khi có user mới trong Supabase Auth
-- ---------------------------------------------------------------------------
create or replace function public.profiles_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  insert into public.profiles (id, email, role_name, is_active)
  values (
    new.id,
    new.email,
    -- Mặc định 'viewer'. Admin phải được nâng cấp thủ công, không tự cấp.
    'viewer',
    true
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.profiles_handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. Nâng cấp admin duy nhất: pquangvinh1999@gmail.com
--    Email đã có sẵn trong auth.users (đã confirm) nên trigger ở trên
--    không chạy; phải upsert thủ công.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, email, role_name, is_active)
select u.id, u.email, 'admin', true
from auth.users u
where lower(u.email) = lower('pquangvinh1999@gmail.com')
on conflict (id) do update
  set role_name   = 'admin',
      is_active   = true,
      email       = excluded.email,
      updated_at  = now();

-- ---------------------------------------------------------------------------
-- 4. HÀM BẢN LỀ — thay thân, giữ nguyên chữ ký
--    p_session_token nay mang JWT của Supabase Auth thay vì token opaque.
--    Mọi hàm app_* gọi hàm này nên tự động chuyển sang Supabase Auth.
-- ---------------------------------------------------------------------------
create or replace function public.app_session_user_id(p_session_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_sub        text;
  v_uid        uuid;
  v_token_hash text;
  v_legacy_id  uuid;
begin
  -- 1) Ưu tiên JWT của Supabase Auth (đọc từ header Authorization).
  v_sub := auth.jwt() ->> 'sub';

  if v_sub is not null then
    begin
      v_uid := v_sub::uuid;
    exception when others then
      return null;
    end;

    -- Chỉ trả về user nếu profile tồn tại và đang hoạt động.
    if exists (
      select 1 from public.profiles
      where id = v_uid and is_active = true
    ) then
      return v_uid;
    end if;

    return null;
  end if;

  -- 2) Đường dự phòng: token opaque cũ (app_sessions).
  --    GIỮ NGUYÊN để không làm hỏng phiên đang chạy.
  --    XOÁ KHỐI NÀY SAU KHI đã drop bảng app_sessions.
  if p_session_token is null or length(trim(p_session_token)) < 20 then
    return null;
  end if;

  v_token_hash := encode(extensions.digest(p_session_token::text, 'sha256'::text), 'hex');

  select s.user_id into v_legacy_id
  from public.app_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token_hash = v_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and u.is_active = true
  limit 1;

  return v_legacy_id;
end;
$$;

comment on function public.app_session_user_id(text) is
  'Bản lề phân quyền: nhận JWT Supabase Auth, trả profiles.id. Còn đường dự phòng token cũ để migration an toàn.';

-- ---------------------------------------------------------------------------
-- 5. GOM DỒ role cho app_me (hàm này đọc app_users.role_name)
--    Cần đổi sang đọc profiles, nếu không app_me sẽ trả role_name = null.
-- ---------------------------------------------------------------------------
create or replace function public.app_me(p_session_token text)
returns table (
  ok boolean,
  user_id uuid,
  username text,
  display_name text,
  role_name text,
  must_change_password boolean,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_uid uuid := public.app_session_user_id(p_session_token);
  v_email text;
  v_role text;
begin
  if v_uid is null then
    return query select false, null::uuid, null::text, null::text,
                        null::text, null::boolean, null::timestamptz;
    return;
  end if;

  select p.role_name, p.email
  into v_role, v_email
  from public.profiles p
  where p.id = v_uid and p.is_active = true
  limit 1;

  if v_role is null then
    return query select false, null::uuid, null::text, null::text,
                        null::text, null::boolean, null::timestamptz;
    return;
  end if;

  return query select true, v_uid, v_email, v_email, v_role, false, null::timestamptz;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS cho profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- Chỉ admin đọc được toàn bộ (dùng cho màn hình quản trị user).
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p2
      where p2.id = auth.uid() and p2.role_name = 'admin' and p2.is_active
    )
  );

-- ============================================================================
-- GHI CHÚ: CHƯA drop app_users / app_sessions trong migration này.
-- Phải làm theo thứ tự:
--   1) chạy file này
--   2) sửa frontend dùng supabase.auth.signInWithPassword()
--   3) xác minh đủ chức năng
--   4) mới drop bảng (xem file ROLLBACK / migration kế tiếp)
-- ============================================================================