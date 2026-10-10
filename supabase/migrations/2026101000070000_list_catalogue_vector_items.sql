-- =============================================================================
-- Migration: 2026101000070000_list_catalogue_vector_items.sql
-- Thêm RPC app_list_catalogue_vector_items để tải toàn bộ mã catalogue kèm assets
-- và trạng thái vector trong 1 câu query duy nhất (thay vì lặp n RPC tuần tự).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.app_list_catalogue_vector_items(
  p_session_token text,
  p_search text DEFAULT ''::text,
  p_limit integer DEFAULT 2000,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id uuid;
  v_search text := trim(coalesce(p_search, ''));
  v_result json;
BEGIN
  v_user_id := public.app_session_user_id(p_session_token);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  WITH vec AS (
    SELECT DISTINCT record_id, object_key
    FROM public.catalogue_image_vectors
    WHERE is_active = true
  ),
  parts AS (
    SELECT
      i.id,
      i.code,
      i.part_id,
      i.usage_side,
      i.view_mode,
      i.image_path AS fallback_path,
      i.updated_at,
      i.created_at
    FROM public.image_library i
    WHERE (
      v_search = ''
      OR concat_ws(' ', i.code, i.part_id, i.identifying_features, i.confusing_note) ILIKE '%' || v_search || '%'
    )
    ORDER BY i.updated_at DESC NULLS LAST, i.created_at DESC NULLS LAST
    LIMIT greatest(1, least(coalesce(p_limit, 2000), 5000))
    OFFSET greatest(0, coalesce(p_offset, 0))
  )
  SELECT json_build_object(
    'ok', true,
    'count', (SELECT count(*) FROM parts),
    'items', coalesce(json_agg(json_build_object(
      'id', p.id,
      'code', coalesce(p.code, 'UNKNOWN'),
      'part_id', coalesce(p.part_id, ''),
      'usage_side', coalesce(p.usage_side, 'unknown'),
      'view_mode', coalesce(p.view_mode, 'single_face'),
      'thumb_path', coalesce(p.fallback_path, ''),
      'has_vector', (
        EXISTS (SELECT 1 FROM vec WHERE vec.record_id = p.id::text)
        OR EXISTS (
          SELECT 1 FROM vec
          JOIN public.image_assets a ON a.image_id = p.id
          WHERE vec.object_key = a.image_path
        )
      ),
      'assets', coalesce((
        SELECT json_agg(json_build_object(
          'asset_type', a.asset_type,
          'image_path', a.image_path,
          'has_vector', EXISTS (SELECT 1 FROM vec WHERE vec.object_key = a.image_path)
        ) ORDER BY
          CASE a.asset_type WHEN 'thumb' THEN 0 WHEN 'front' THEN 1 WHEN 'back' THEN 2 WHEN 'detail' THEN 3 ELSE 9 END,
          a.sort_order
        )
        FROM public.image_assets a
        WHERE a.image_id = p.id AND a.image_path IS NOT NULL AND a.image_path <> ''
      ), CASE WHEN p.fallback_path IS NOT NULL AND p.fallback_path <> '' THEN
        json_build_array(json_build_object(
          'asset_type', 'front',
          'image_path', p.fallback_path,
          'has_vector', (
            EXISTS (SELECT 1 FROM vec WHERE vec.record_id = p.id::text)
            OR EXISTS (SELECT 1 FROM vec WHERE vec.object_key = p.fallback_path)
          )
        ))
      ELSE '[]'::json END)
    )), '[]'::json)
  )
  INTO v_result
  FROM parts p;

  RETURN coalesce(v_result, json_build_object('ok', true, 'count', 0, 'items', '[]'::json));
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_list_catalogue_vector_items(text, text, integer, integer) TO anon, authenticated, service_role;
