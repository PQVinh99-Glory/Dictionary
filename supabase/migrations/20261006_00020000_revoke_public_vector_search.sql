-- ============================================================================
-- 20261006_00020000_revoke_public_vector_search.sql
--
-- BẰNG CHỨNG (đo trực tiếp trên DB ngày 2026-10-06):
--   has_function_privilege('anon','match_catalogue_image_vectors','EXECUTE') = true
--   → gọi bằng anon key, KHÔNG đăng nhập, trả về object_key ảnh catalogue.
--     Ví dụ thực tế:
--       [{"record_id":"f73b0fd9-…","object_key":"front/3405190101/2131129e-….webp",
--         "similarity":0.0324…}]
--   Kết hợp R2 bucket public => ai cũng liệt kê được toàn bộ kho ảnh.
--
-- Migration 20260915000100 đã ghi revoke nhưng không có hiệu lực.
-- Chạy đúng chữ ký (lấy từ pg_proc) để chắc chắn khớp.
--
-- ẢNH HƯỞNG: hàm này chỉ được gọi từ endpoint service-role
-- (functions/api/kim/*). Frontend không gọi RPC này trực tiếp → không vỡ gì.
-- ============================================================================

do $$
declare
  sig text;
begin
  select pg_get_function_identity_arguments(p.oid) into sig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'match_catalogue_image_vectors'
  limit 1;

  if sig is null then
    raise exception 'không tìm thấy public.match_catalogue_image_vectors';
  end if;

  execute format(
    'revoke all on function public.match_catalogue_image_vectors(%s) from public, anon, authenticated',
    sig
  );
  execute format(
    'grant execute on function public.match_catalogue_image_vectors(%s) to service_role',
    sig
  );

  raise notice 'đã revoke anon/authenticated trên match_catalogue_image_vectors(%s)', sig;
end;
$$;
