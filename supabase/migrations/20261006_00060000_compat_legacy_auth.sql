-- =============================================================================
-- Migration 0006: Cầu nối tương thích — production KHÔNG cần deploy
-- =============================================================================
-- Bối cảnh: migrations 0001-0005 đã đổi sang Supabase Auth, nhưng production
-- (dictionary-dnw.pages.dev) vẫn chạy code cũ: gửi Bearer <anon> + token opaque
-- trong p_session_token, và gọi RPC app_login/app_logout. Hậu quả đã verify:
--   * app_login  -> 404 PGRST202 (báo lỗi người dùng)
--   * app_me     -> ok:false, user_id:null (Bearer anon không có claim sub)
-- Quyết định: GIỮ code mới chạy song song, dựng lại nhánh legacy dưới JWT.
--
-- Được phép:
--   * Nhánh JWT (auth.jwt()->>'sub') VẪN là nhánh ưu tiên -> code mới không đổi.
--   * app_login hỗ trợ CẢ email (Supabase Auth) CẢ username legacy.
--     Kiểm chứng: crypt('Quangvinh99@', auth.users.encrypted_password) = true
--     -> xác minh password ngay trong SQL, KHÔNG cần pg_net (extension không có).
--   * 2 bảng FK image_library.*_user_id đang trỏ profiles thì GIỮ NGUYÊN
--     (app_upsert_part_metadata / app_replace_part_assets không ghi 2 cột đó).
--
-- Sẽ drop lại sau khi deploy code mới.
-- Backup: /tmp/opencode/backup/20261006_app_users.json (9 user, bcrypt $2a$12$)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Bảng app_users (legacy) + 9 user từ backup
-- -----------------------------------------------------------------------------
create table if not exists public.app_users (
  id                   uuid primary key default gen_random_uuid(),
  username             text not null unique,
  password_hash        text not null,
  display_name         text,
  role_name            text not null default 'viewer',
  is_active            boolean not null default true,
  must_change_password boolean not null default false,
  failed_login_count   integer not null default 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists app_users_username_lower_idx
  on public.app_users (lower(username));

insert into public.app_users (id, username, password_hash, display_name, role_name, is_active, must_change_password, failed_login_count, locked_until, last_login_at, created_at, updated_at) values
('2ca59d1e-7b55-4e84-8f10-061e04bed196', 'Khoa', '$2a$12$EGRkXdbac5I6jWKwL48pfu51Y46QwPN0lpT5X.Ggt9K7gPl0e6WYO', 'Khoa', 'viewer', true, false, 0, null, '2026-07-01T12:26:07.981Z', '2026-06-30T02:02:29.897Z', '2026-07-01T12:26:07.981Z'),
('74c8f168-b52a-48dd-a67d-532a1c4bda70', 'Nam', '$2a$12$Hoi2eStcQvCX5ub2gB0s8e0Q.iKzAk9OVlD5vHQiv4pE4SFRdujbK', 'Nam', 'viewer', true, false, 0, null, null, '2026-06-30T02:02:29.897Z', '2026-06-30T05:08:41.504Z'),
('b6aa9967-f5b6-4389-b7ec-4d120d0bfd5e', 'Tra', '$2a$12$zCC.7WhSL6uTwd4ZL3utVeGEPEL2K5b1NMZagmoDdrBWX2iPM0w9a', 'Tra', 'viewer', true, false, 0, null, '2026-07-01T14:18:27.667Z', '2026-06-30T02:02:29.897Z', '2026-07-01T14:18:27.667Z'),
('000fe86e-c685-4b28-b91f-1489043c0f1e', 'Thanh', '$2a$12$Q/19.Ovpn7bbwzLpxN6w7OnuUbUrEI3AUVuco7CchA2bzBfXGPX6i', 'Thanh', 'admin', true, false, 0, null, '2026-07-02T00:37:16.704Z', '2026-06-30T02:02:29.897Z', '2026-07-02T00:37:16.704Z'),
('db6df15c-44fc-4ff8-96d8-30bce996b15c', 'Trinh', '$2a$12$U.9Om1E2PK/dBdKT264EYuZNYQcARCSFOt2aN8M3MdLx/lxcwVWTW', 'Trinh', 'admin', true, false, 0, null, '2026-09-25T01:48:24.353Z', '2026-06-30T02:02:29.897Z', '2026-09-25T01:48:24.353Z'),
('49868fc6-db0a-4c49-9bea-86c6b427a6bb', 'Luu', '$2a$12$Q0BzPorLm7D9r1XNZVmuOu9bSjKk3zwv/Uf8PUTeE5mSTxvnJriu.', 'Luu', 'admin', true, false, 0, null, null, '2026-06-30T02:02:29.897Z', '2026-06-30T05:08:41.504Z'),
('d39034ef-b159-4459-9b57-082d1a44e5ff', 'Vinh', '$2a$12$qj57hDRuPFphVyCSz48BgeveDmL0qASH9E6bB.lS9I3wBTDr2CQsa', 'Vinh', 'admin', true, false, 0, null, '2026-10-06T01:10:40.760Z', '2026-06-30T02:02:29.897Z', '2026-10-06T03:26:04.614Z'),
('815903fb-b3db-4147-92aa-540940a196be', 'Chieu', '$2a$12$gXPvVyvlPvPKBS6ljlYGs.dzVNtelUaNioe9Zw9MbxiHCzhRzMRKS', 'Chieu', 'admin', true, false, 0, null, '2026-07-01T08:02:35.712Z', '2026-06-30T02:02:29.897Z', '2026-07-01T08:02:35.712Z'),
('d64ed860-7cbf-4e7b-a0f1-eb40756fa64d', 'Na', '$2a$12$AAluHbrbR8c/PLSL0gv43OfqzGFcIQFIY4zIt5tuidUsnp.FateYC', 'Na', 'viewer', true, false, 0, null, '2026-08-18T04:16:22.978Z', '2026-06-30T02:02:29.897Z', '2026-08-18T04:16:22.978Z')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2) Bảng app_sessions (legacy). 63 session cũ MẤT token_hash (không backup)
--    -> mọi user phải đăng nhập lại. Dung lượng chấp nhận được.
-- -----------------------------------------------------------------------------
create table if not exists public.app_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.app_users(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_seen_at timestamptz
);

create index if not exists app_sessions_user_id_idx on public.app_sessions (user_id);
create index if not exists app_sessions_expires_idx on public.app_sessions (expires_at);

-- app_login ghi app_audit_log.user_id = app_users.id -> FK phải trỏ lại app_users.
alter table public.app_audit_log
  drop constraint if exists app_audit_log_user_id_fkey;
alter table public.app_audit_log
  add constraint app_audit_log_user_id_fkey
  foreign key (user_id) references public.app_users(id) on delete set null;

grant select, insert, update, delete on public.app_users, public.app_sessions to service_role;

-- -----------------------------------------------------------------------------
-- 3) app_session_user_id: JWT trước, fallback token opaque
-- -----------------------------------------------------------------------------
create or replace function public.app_session_user_id(p_session_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_sub        text;
  v_uid        uuid;
  v_token_hash text;
  v_legacy_id  uuid;
begin
  -- (1) JWT của Supabase Auth — nhánh MỚI, luôn ưu tiên.
  v_sub := auth.jwt() ->> 'sub';
  if v_sub is not null then
    begin
      v_uid := v_sub::uuid;
    exception when others then
      return null;
    end;
    if exists (select 1 from public.profiles where id = v_uid and is_active = true) then
      return v_uid;
    end if;
    return null;
  end if;

  -- (2) Token opaque cũ — cầu nối cho production CHƯA deploy.
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
$function$;

-- -----------------------------------------------------------------------------
-- 4) app_session_role: profiles trước, app_users fallback
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

  select p.role_name into v_role
  from public.profiles p
  where p.id = v_uid and p.is_active = true
  limit 1;
  if v_role is not null then
    return v_role;
  end if;

  select u.role_name into v_role
  from public.app_users u
  where u.id = v_uid and u.is_active = true
  limit 1;

  return v_role;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 5) app_me: profiles trước, app_users fallback (user legacy như 'Vinh')
-- -----------------------------------------------------------------------------
create or replace function public.app_me(p_session_token text)
returns table(ok boolean, user_id uuid, username text, display_name text,
              role_name text, must_change_password boolean, expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_uid     uuid := public.app_session_user_id(p_session_token);
  v_role    text;
  v_email   text;
  v_name    text;
  v_must    boolean := false;
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
    select u.role_name, u.username, u.display_name, u.must_change_password
      into v_role, v_email, v_name, v_must
    from public.app_users u
    where u.id = v_uid and u.is_active = true
    limit 1;
  end if;

  if v_role is null then
    return query select false, null::uuid, null::text, null::text,
                        null::text, null::boolean, null::timestamptz;
    return;
  end if;

  return query select true, v_uid,
                      coalesce(v_email, ''), coalesce(v_name, v_email, ''),
                      v_role, coalesce(v_must, false), null::timestamptz;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 6) app_logout: y hệt bản gốc (revoked_at = now())
-- -----------------------------------------------------------------------------
create or replace function public.app_logout(p_session_token text)
returns table(ok boolean, message text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_token_hash text;
begin
  if p_session_token is null then
    return query select true, 'Đã đăng xuất';
    return;
  end if;

  v_token_hash := encode(extensions.digest(p_session_token::text, 'sha256'::text), 'hex');

  update public.app_sessions
  set revoked_at = now()
  where token_hash = v_token_hash
    and revoked_at is null;

  return query select true, 'Đã đăng xuất';
end;
$function$;

-- -----------------------------------------------------------------------------
-- 7) app_login: bản gốc + nhánh EMAIL (Supabase Auth qua auth.users/bcrypt)
-- -----------------------------------------------------------------------------
create or replace function public.app_login(p_username text, p_password text)
returns table(ok boolean, message text, session_token text, expires_at timestamptz,
              user_id uuid, username text, display_name text, role_name text,
              must_change_password boolean)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_user        public.app_users%rowtype;
  v_auth_id     uuid;
  v_auth_email  text;
  v_auth_hash   text;
  v_token       text;
  v_token_hash  text;
  v_expires_at  timestamptz;
begin
  if nullif(trim(coalesce(p_username, '')), '') is null then
    return query select false, 'Sai tên đăng nhập hoặc mật khẩu', null::text,
                        null::timestamptz, null::uuid, null::text, null::text,
                        null::text, null::boolean;
    return;
  end if;

  ------------------------------------------------------------------
  -- (A) Username chứa '@' -> xác minh trực tiếp trên auth.users
  --     (bcrypt. Không cần pg_net.)
  ------------------------------------------------------------------
  if position('@' in trim(p_username)) > 0 then
    select u.id, u.email, u.encrypted_password
      into v_auth_id, v_auth_email, v_auth_hash
    from auth.users u
    where lower(u.email) = lower(trim(p_username))
      and u.encrypted_password is not null
      and crypt(coalesce(p_password, ''), u.encrypted_password) = u.encrypted_password
    limit 1;

    if v_auth_id is null then
      return query select false, 'Sai tên đăng nhập hoặc mật khẩu', null::text,
                          null::timestamptz, null::uuid, null::text, null::text,
                          null::text, null::boolean;
      return;
    end if;

    if not exists (select 1 from public.profiles where id = v_auth_id and is_active = true)
       and exists (select 1 from public.profiles where id = v_auth_id) then
      return query select false, 'Tài khoản đã bị khóa', null::text,
                          null::timestamptz, null::uuid, null::text, null::text,
                          null::text, null::boolean;
      return;
    end if;

    -- Đồng bộ vào app_users để app_sessions FK + nhánh legacy chạy được.
    insert into public.app_users
      (id, username, password_hash, display_name, role_name, is_active,
       must_change_password, failed_login_count, last_login_at, created_at, updated_at)
    select v_auth_id, v_auth_email, v_auth_hash, v_auth_email,
           coalesce((select p.role_name from public.profiles p where p.id = v_auth_id), 'viewer'),
           coalesce((select p.is_active  from public.profiles p where p.id = v_auth_id), true),
           false, 0, now(), now(), now()
    on conflict (id) do update
      set username        = excluded.username,
          password_hash   = excluded.password_hash,
          display_name    = excluded.display_name,
          role_name       = excluded.role_name,
          is_active       = excluded.is_active,
          last_login_at   = now(),
          failed_login_count = 0,
          locked_until    = null,
          updated_at      = now();

    select * into v_user from public.app_users where id = v_auth_id limit 1;
  else
  ------------------------------------------------------------------
  -- (B) Username legacy -> app_users (bcrypt), y hệt bản gốc
  ------------------------------------------------------------------
    select * into v_user
    from public.app_users
    where lower(app_users.username) = lower(trim(p_username))
    limit 1;

    if not found then
      return query select false, 'Sai tên đăng nhập hoặc mật khẩu', null::text,
                          null::timestamptz, null::uuid, null::text, null::text,
                          null::text, null::boolean;
      return;
    end if;

    if v_user.is_active = false then
      return query select false, 'Tài khoản đã bị khóa', null::text,
                          null::timestamptz, null::uuid, null::text, null::text,
                          null::text, null::boolean;
      return;
    end if;

    if v_user.locked_until is not null and v_user.locked_until > now() then
      return query select false, 'Tài khoản đang bị khóa tạm thời do nhập sai nhiều lần',
                          null::text, null::timestamptz, null::uuid, null::text,
                          null::text, null::text, null::boolean;
      return;
    end if;

    if v_user.password_hash <> crypt(coalesce(p_password, ''), v_user.password_hash) then
      update public.app_users
      set failed_login_count = failed_login_count + 1,
          locked_until = case when failed_login_count + 1 >= 5
                              then now() + interval '15 minutes'
                              else locked_until end,
          updated_at = now()
      where id = v_user.id;

      insert into public.app_audit_log(user_id, action_name, target_table, target_id, detail)
      values (v_user.id, 'LOGIN_FAILED', 'app_users', v_user.id::text,
              jsonb_build_object('username', v_user.username));

      return query select false, 'Sai tên đăng nhập hoặc mật khẩu', null::text,
                          null::timestamptz, null::uuid, null::text, null::text,
                          null::text, null::boolean;
      return;
    end if;
  end if;

  ------------------------------------------------------------------
  -- Cấp token opaque chung cho cả 2 nhánh
  ------------------------------------------------------------------
  v_token      := encode(gen_random_bytes(32), 'hex') || '.' || replace(gen_random_uuid()::text, '-', '');
  v_token_hash := encode(digest(v_token, 'sha256'), 'hex');
  v_expires_at := now() + interval '30 days';

  insert into public.app_sessions(user_id, token_hash, expires_at, last_seen_at)
  values (v_user.id, v_token_hash, v_expires_at, now());

  update public.app_users
  set failed_login_count = 0,
      locked_until = null,
      last_login_at = now(),
      updated_at = now()
  where id = v_user.id;

  insert into public.app_audit_log(user_id, action_name, target_table, target_id, detail)
  values (v_user.id, 'LOGIN_SUCCESS', 'app_users', v_user.id::text,
          jsonb_build_object('username', v_user.username));

  return query select true, 'Đăng nhập thành công', v_token, v_expires_at,
                      v_user.id, v_user.username, v_user.display_name,
                      v_user.role_name, v_user.must_change_password;
end;
$function$;
