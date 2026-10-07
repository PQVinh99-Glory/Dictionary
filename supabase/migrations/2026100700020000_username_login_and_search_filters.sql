-- =============================================================================
-- Migration 2026100700020000
--   1) profiles.username  — admin thêm user bằng TÊN ĐĂNG NHẬP (không cần email)
--   2) app_search_catalogue — coi p_usage_side / p_view_mode rỗng ('') như 'all'
-- =============================================================================
-- Bối cảnh 1):
--   Đăng nhập trước đây nhận email. Admin cần tạo user chỉ bằng tên đăng nhập
--   (client dùng gmail ảo trong Supabase Auth nên không lấy email làm tên gọi).
--   Supabase Auth vẫn bắt buộc 1 email để định danh => hệ thống tự sinh
--   <username>@users.catalogue.vn (email_confirm = true, không gửi thư).
--   Đăng nhập nhận CẢ email lẫn tên đăng nhập (xem resolveLoginProfile).
--
-- Bối cảnh 2):
--   app_search_catalogue chỉ bỏ lọc khi giá trị = 'all' (hoặc NULL).
--   Frontend gửi ''  =>  where usage_side = ''  => 0 dòng:
--     * ảnh mã trong modal "Quy đổi" báo "chưa có ảnh" (vd 3427470401);
--     * check trùng mã trong "Thêm mã mới" không bao giờ bắt trùng.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cột username
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists username text;

comment on column public.profiles.username is
  'Tên đăng nhập do admin tạo (không phải email). Login nhận cả username lẫn email.';

-- Backfill từ phần trước '@' của email — chỉ khi username chưa bị chiếm,
-- để không phá unique index (email trùng local-part sẽ bỏ qua).
do $$
declare r record;
begin
  for r in
    select id, split_part(coalesce(email, ''), '@', 1) as localpart
      from public.profiles
     where username is null
       and position('@' in coalesce(email, '')) > 1
  loop
    if exists (
      select 1
        from public.profiles p
       where p.username is not null
         and lower(p.username) = lower(r.localpart)
    ) then
      continue;
    end if;

    update public.profiles
       set username = r.localpart,
           updated_at = now()
     where id = r.id;
  end loop;
end $$;

create unique index if not exists profiles_username_uniq
  on public.profiles (lower(username))
  where username is not null;

-- ---------------------------------------------------------------------------
-- 2. app_search_catalogue: '' (rỗng / toàn khoảng trắng) = 'all'
-- ---------------------------------------------------------------------------
create or replace function public.app_search_catalogue(
  p_session_token text,
  p_search text default ''::text,
  p_usage_side text default 'all'::text,
  p_view_mode text default 'all'::text,
  p_limit integer default 60,
  p_offset integer default 0
)
returns table (
  id uuid,
  code text,
  part_id text,
  usage_side text,
  identifying_features text,
  view_mode text,
  is_symmetric boolean,
  confusing_note text,
  fallback_path text,
  fallback_provider text,
  thumb_path text,
  thumb_provider text,
  front_path text,
  front_provider text,
  back_path text,
  back_provider text,
  detail_count integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_search text := trim(coalesce(p_search, ''));
  v_usage  text := coalesce(nullif(trim(coalesce(p_usage_side, '')), ''), 'all');
  v_view   text := coalesce(nullif(trim(coalesce(p_view_mode, '')), ''), 'all');
begin
  if public.app_session_user_id(p_session_token) is null then
    raise exception 'UNAUTHORIZED';
  end if;

  return query
  with filtered as (
    select i.*
    from public.image_library i
    where (v_usage = 'all' or i.usage_side = v_usage)
      and (v_view = 'all' or i.view_mode = v_view)
      and (
        v_search = ''
        or concat_ws(' ', i.code, i.part_id, i.identifying_features, i.confusing_note) ilike '%' || v_search || '%'
      )
    order by i.updated_at desc nulls last, i.created_at desc nulls last
    limit greatest(1, least(coalesce(p_limit, 60), 120))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    i.id,
    i.code,
    i.part_id,
    i.usage_side,
    i.identifying_features,
    i.view_mode,
    i.is_symmetric,
    i.confusing_note,
    i.image_path as fallback_path,
    case when i.image_path like 'parts/%' then 'r2' else 'supabase' end as fallback_provider,
    th.image_path as thumb_path,
    th.storage_provider as thumb_provider,
    fr.image_path as front_path,
    fr.storage_provider as front_provider,
    ba.image_path as back_path,
    ba.storage_provider as back_provider,
    coalesce(dc.detail_count, 0)::int as detail_count,
    i.updated_at
  from filtered i
  left join lateral (
    select a.image_path, a.storage_provider
    from public.image_assets a
    where a.image_id = i.id and a.asset_type = 'thumb'
    order by a.sort_order
    limit 1
  ) th on true
  left join lateral (
    select a.image_path, a.storage_provider
    from public.image_assets a
    where a.image_id = i.id and a.asset_type = 'front'
    order by a.sort_order
    limit 1
  ) fr on true
  left join lateral (
    select a.image_path, a.storage_provider
    from public.image_assets a
    where a.image_id = i.id and a.asset_type = 'back'
    order by a.sort_order
    limit 1
  ) ba on true
  left join lateral (
    select count(*)::int as detail_count
    from public.image_assets a
    where a.image_id = i.id and a.asset_type = 'detail'
  ) dc on true;
end;
$function$;

-- Quyền giữ nguyên theo bản gốc (REVOKE/GRANT đã có sẵn trên object cũ
-- nên CREATE OR REPLACE không làm mất grant).
