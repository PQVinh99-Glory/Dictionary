-- =============================================================================
-- Migration: 2026101000030000_vector_purge_and_list.sql
-- Thêm RPC xóa toàn bộ vector (Purge All Vectors) và liệt kê vector đã có
-- =============================================================================

CREATE OR REPLACE FUNCTION public.kim_purge_all_catalogue_image_vectors(p_session_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me json;
BEGIN
  v_me := public.app_me(p_session_token);
  IF (v_me->>'ok')::boolean IS NOT TRUE OR lower(v_me->>'role_name') <> 'admin' THEN
    RAISE EXCEPTION 'Chỉ admin có quyền xóa toàn bộ vector.';
  END IF;

  TRUNCATE TABLE public.catalogue_image_vectors;
  
  RETURN json_build_object('ok', true, 'message', 'Đã xóa toàn bộ vector thành công.');
END;
$$;

CREATE OR REPLACE FUNCTION public.kim_list_vector_record_ids(p_session_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me json;
  v_result json;
BEGIN
  v_me := public.app_me(p_session_token);
  IF (v_me->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Phiên đăng nhập không hợp lệ.';
  END IF;

  SELECT json_agg(json_build_object('record_id', record_id, 'asset_type', asset_type, 'object_key', object_key))
  INTO v_result
  FROM (
    SELECT DISTINCT record_id, asset_type, object_key
    FROM public.catalogue_image_vectors
    WHERE is_active = true
  ) t;

  RETURN json_build_object('ok', true, 'items', coalesce(v_result, '[]'::json));
END;
$$;
