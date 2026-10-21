-- P06/P08 scoped retrieval and session-checked keyed hydration.
-- Apply after the preceding V6 provenance migration; functions remain behind runtime flags.
-- Read-only service-role RPC; caller passes IDs from the bounded length shortlist.
CREATE FUNCTION public.match_catalogue_image_vectors_scoped_v1(
  p_query_embedding halfvec(384),
  p_embedding_model text,
  p_embedding_model_version text,
  p_preprocess_version text,
  p_embedding_profile text,
  p_record_ids text[],
  p_match_count integer DEFAULT 100
)
RETURNS TABLE (
  record_id text, asset_type text, object_key text, similarity double precision,
  hole_count integer, aspect_ratio real, hole_centroids jsonb,
  geometry_version text, quality jsonb, provenance text,
  embedding_signature_version text
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_record_ids IS NULL OR cardinality(p_record_ids) < 1 OR cardinality(p_record_ids) > 2000 THEN
    RAISE EXCEPTION 'Invalid scoped record ID budget';
  END IF;
  RETURN QUERY
  SELECT v.record_id, v.asset_type, v.object_key,
    1 - (v.embedding <=> p_query_embedding),
    v.hole_count, v.aspect_ratio, v.hole_centroids,
    v.geometry_evidence->>'geometry_version',
    v.geometry_evidence->'quality',
    v.geometry_evidence->>'provenance', v.embedding_signature_version
  FROM public.catalogue_image_vectors v
  WHERE v.is_active
    AND v.record_id = ANY(p_record_ids)
    AND v.embedding_model = p_embedding_model
    AND v.embedding_model_version = p_embedding_model_version
    AND v.preprocess_version = p_preprocess_version
    AND v.embedding_profile = p_embedding_profile
  ORDER BY v.embedding <=> p_query_embedding
  LIMIT greatest(1, least(coalesce(p_match_count, 100), 100));
END;
$$;
REVOKE ALL ON FUNCTION public.match_catalogue_image_vectors_scoped_v1(halfvec,text,text,text,text,text[],integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_catalogue_image_vectors_scoped_v1(halfvec,text,text,text,text,text[],integer)
  TO service_role;

-- Session-checked keyed hydration, bounded to 100 UUIDs per call. Projection
-- mirrors app_search_catalogue, including image-asset paths used by the UI.
CREATE FUNCTION public.app_get_catalogue_by_ids_moris_v1(
  p_session_token text, p_record_ids uuid[],
  p_usage_side text DEFAULT 'all', p_view_mode text DEFAULT 'all'
)
RETURNS TABLE (
  id uuid, code text, part_id text, usage_side text,
  identifying_features text, view_mode text, is_symmetric boolean,
  confusing_note text, fallback_path text, fallback_provider text,
  thumb_path text, thumb_provider text, front_path text,
  front_provider text, back_path text, back_provider text,
  detail_count integer, updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF public.app_session_user_id(p_session_token) IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF p_record_ids IS NULL OR cardinality(p_record_ids) < 1 OR cardinality(p_record_ids) > 100 THEN
    RAISE EXCEPTION 'Invalid keyed hydration budget';
  END IF;
  RETURN QUERY
  SELECT i.id, i.code, i.part_id, i.usage_side, i.identifying_features,
    i.view_mode, i.is_symmetric, i.confusing_note,
    i.image_path,
    CASE WHEN i.image_path LIKE 'parts/%' THEN 'r2' ELSE 'supabase' END,
    th.image_path, th.storage_provider,
    fr.image_path, fr.storage_provider,
    ba.image_path, ba.storage_provider,
    dc.detail_count, i.updated_at
  FROM public.image_library i
  LEFT JOIN LATERAL (
    SELECT a.image_path, a.storage_provider FROM public.image_assets a
    WHERE a.image_id=i.id AND a.asset_type='thumb' ORDER BY a.sort_order LIMIT 1
  ) th ON true
  LEFT JOIN LATERAL (
    SELECT a.image_path, a.storage_provider FROM public.image_assets a
    WHERE a.image_id=i.id AND a.asset_type='front' ORDER BY a.sort_order LIMIT 1
  ) fr ON true
  LEFT JOIN LATERAL (
    SELECT a.image_path, a.storage_provider FROM public.image_assets a
    WHERE a.image_id=i.id AND a.asset_type='back' ORDER BY a.sort_order LIMIT 1
  ) ba ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS detail_count FROM public.image_assets a
    WHERE a.image_id=i.id AND a.asset_type='detail'
  ) dc ON true
  WHERE i.id=ANY(p_record_ids)
    AND (p_usage_side='all' OR i.usage_side=p_usage_side)
    AND (p_view_mode='all' OR i.view_mode=p_view_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.app_get_catalogue_by_ids_moris_v1(text,uuid[],text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_get_catalogue_by_ids_moris_v1(text,uuid[],text,text)
  TO anon, authenticated, service_role;

-- Filter the length shortlist against the same user/session catalogue view
-- without scanning all catalogue rows. The service-role vector RPC sees only
-- the IDs this session-checked function returned.
CREATE FUNCTION public.app_filter_catalogue_ids_moris_v1(
  p_session_token text, p_record_ids uuid[],
  p_usage_side text DEFAULT 'all', p_view_mode text DEFAULT 'all'
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF public.app_session_user_id(p_session_token) IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;
  IF p_record_ids IS NULL OR cardinality(p_record_ids) < 1 OR cardinality(p_record_ids) > 2000 THEN
    RAISE EXCEPTION 'Invalid shortlist ID budget';
  END IF;
  RETURN QUERY
  SELECT i.id FROM public.image_library i
  WHERE i.id=ANY(p_record_ids)
    AND (p_usage_side='all' OR i.usage_side=p_usage_side)
    AND (p_view_mode='all' OR i.view_mode=p_view_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.app_filter_catalogue_ids_moris_v1(text,uuid[],text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_filter_catalogue_ids_moris_v1(text,uuid[],text,text)
  TO anon, authenticated, service_role;
