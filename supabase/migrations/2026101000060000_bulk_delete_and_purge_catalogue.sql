-- =============================================================================
-- Migration: 2026101000060000_bulk_delete_and_purge_catalogue.sql
-- Thêm RPC xóa hàng loạt (Bulk Delete) và xóa tất cả (Purge All) cho Catalogue
-- Chỉ tài khoản Admin mới có quyền thực thi.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.app_bulk_delete_parts(
  p_session_token text,
  p_image_ids uuid[]
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_r2_keys text[];
  v_deleted_count int;
BEGIN
  v_role := public.app_session_role(p_session_token);
  IF v_role IS NULL OR lower(v_role) <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ admin có quyền xóa hàng loạt mã linh kiện.';
  END IF;

  IF p_image_ids IS NULL OR cardinality(p_image_ids) = 0 THEN
    RETURN json_build_object('ok', true, 'deleted_count', 0, 'r2_keys', '[]'::json);
  END IF;

  -- 1. Thu thập toàn bộ object key trên R2 của các mã cần xóa
  SELECT coalesce(array_agg(DISTINCT k), ARRAY[]::text[])
  INTO v_r2_keys
  FROM (
    SELECT a.image_path AS k
    FROM public.image_assets a
    WHERE a.image_id = ANY(p_image_ids) AND a.image_path IS NOT NULL AND a.image_path <> ''
    UNION
    SELECT i.image_path AS k
    FROM public.image_library i
    WHERE i.id = ANY(p_image_ids) AND i.image_path IS NOT NULL AND i.image_path <> ''
  ) s;

  -- 2. Xóa bản ghi trong image_library (tự động cascade xóa image_assets và catalogue_image_vectors qua trigger/FK)
  DELETE FROM public.image_library
  WHERE id = ANY(p_image_ids);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN json_build_object(
    'ok', true,
    'deleted_count', v_deleted_count,
    'r2_keys', coalesce(to_json(v_r2_keys), '[]'::json)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.app_delete_all_parts(
  p_session_token text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_r2_keys text[];
  v_deleted_count int;
BEGIN
  v_role := public.app_session_role(p_session_token);
  IF v_role IS NULL OR lower(v_role) <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ admin có quyền xóa toàn bộ catalogue.';
  END IF;

  -- 1. Thu thập toàn bộ object key trên R2 trước khi xóa
  SELECT coalesce(array_agg(DISTINCT k), ARRAY[]::text[])
  INTO v_r2_keys
  FROM (
    SELECT a.image_path AS k
    FROM public.image_assets a
    WHERE a.image_path IS NOT NULL AND a.image_path <> ''
    UNION
    SELECT i.image_path AS k
    FROM public.image_library i
    WHERE i.image_path IS NOT NULL AND i.image_path <> ''
  ) s;

  -- 2. Xóa toàn bộ dữ liệu catalogue
  DELETE FROM public.image_library;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  -- Đảm bảo xóa sạch catalogue_image_vectors và image_assets (phòng hờ)
  DELETE FROM public.catalogue_image_vectors;
  DELETE FROM public.image_assets;

  RETURN json_build_object(
    'ok', true,
    'deleted_count', v_deleted_count,
    'r2_keys', coalesce(to_json(v_r2_keys), '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_bulk_delete_parts(text, uuid[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_delete_all_parts(text) TO anon, authenticated, service_role;
