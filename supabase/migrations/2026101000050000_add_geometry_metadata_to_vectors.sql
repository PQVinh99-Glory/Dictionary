-- Migration: 2026101000050000_add_geometry_metadata_to_vectors.sql
-- Thêm metadata hình học (hole_count, aspect_ratio, hole_centroids) vào catalogue_image_vectors
-- Cập nhật RPC kim_upsert_catalogue_image_vector và match_catalogue_image_vectors

-- 1. Bổ sung cột vào catalogue_image_vectors
ALTER TABLE public.catalogue_image_vectors
  ADD COLUMN IF NOT EXISTS hole_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aspect_ratio real DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS hole_centroids jsonb DEFAULT '[]'::jsonb;

-- 2. Cập nhật RPC kim_upsert_catalogue_image_vector
DROP FUNCTION IF EXISTS public.kim_upsert_catalogue_image_vector(text, text, text, text, text, text, text, text, halfvec, text, real);

CREATE OR REPLACE FUNCTION public.kim_upsert_catalogue_image_vector(
  p_record_id text,
  p_asset_type text,
  p_object_key text,
  p_view_variant text,
  p_embedding_model text,
  p_embedding_model_version text,
  p_preprocess_version text,
  p_embedding_profile text,
  p_embedding halfvec,
  p_foreground_status text DEFAULT 'unknown'::text,
  p_quality_score real DEFAULT NULL::real,
  p_hole_count integer DEFAULT 0,
  p_aspect_ratio real DEFAULT 1.0,
  p_hole_centroids jsonb DEFAULT '[]'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.catalogue_image_vectors (
    record_id,
    asset_type,
    object_key,
    view_variant,
    embedding_model,
    embedding_model_version,
    preprocess_version,
    embedding_profile,
    embedding,
    foreground_status,
    quality_score,
    hole_count,
    aspect_ratio,
    hole_centroids,
    is_active,
    updated_at
  )
  VALUES (
    p_record_id,
    p_asset_type,
    p_object_key,
    COALESCE(p_view_variant, 'canonical'),
    p_embedding_model,
    p_embedding_model_version,
    p_preprocess_version,
    p_embedding_profile,
    p_embedding,
    COALESCE(p_foreground_status, 'unknown'),
    p_quality_score,
    COALESCE(p_hole_count, 0),
    COALESCE(p_aspect_ratio, 1.0),
    COALESCE(p_hole_centroids, '[]'::jsonb),
    true,
    now()
  )
  ON CONFLICT (
    record_id,
    asset_type,
    object_key,
    view_variant,
    embedding_model,
    embedding_model_version,
    preprocess_version,
    embedding_profile
  )
  DO UPDATE SET
    embedding = excluded.embedding,
    foreground_status = excluded.foreground_status,
    quality_score = excluded.quality_score,
    hole_count = excluded.hole_count,
    aspect_ratio = excluded.aspect_ratio,
    hole_centroids = excluded.hole_centroids,
    is_active = true,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kim_upsert_catalogue_image_vector(
  text, text, text, text, text, text, text, text, halfvec, text, real, integer, real, jsonb
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.kim_upsert_catalogue_image_vector(
  text, text, text, text, text, text, text, text, halfvec, text, real, integer, real, jsonb
) TO service_role;

-- 3. Cập nhật RPC match_catalogue_image_vectors trả về kèm metadata hình học
DROP FUNCTION IF EXISTS public.match_catalogue_image_vectors(halfvec, text, text, text, text, integer);

CREATE OR REPLACE FUNCTION public.match_catalogue_image_vectors(
  p_query_embedding halfvec(384),
  p_embedding_model text,
  p_embedding_model_version text,
  p_preprocess_version text,
  p_embedding_profile text,
  p_match_count integer DEFAULT 30
)
RETURNS TABLE (
  record_id text,
  asset_type text,
  object_key text,
  similarity double precision,
  hole_count integer,
  aspect_ratio real,
  hole_centroids jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.record_id,
    v.asset_type,
    v.object_key,
    1 - (v.embedding <=> p_query_embedding) AS similarity,
    COALESCE(v.hole_count, 0) AS hole_count,
    COALESCE(v.aspect_ratio, 1.0) AS aspect_ratio,
    COALESCE(v.hole_centroids, '[]'::jsonb) AS hole_centroids
  FROM public.catalogue_image_vectors v
  WHERE v.is_active = true
    AND v.embedding_model = p_embedding_model
    AND v.embedding_model_version = p_embedding_model_version
    AND v.preprocess_version = p_preprocess_version
    AND v.embedding_profile = p_embedding_profile
  ORDER BY v.embedding <=> p_query_embedding
  LIMIT GREATEST(
    1,
    LEAST(COALESCE(p_match_count, 30), 100)
  );
$$;

REVOKE ALL ON FUNCTION public.match_catalogue_image_vectors(
  halfvec, text, text, text, text, integer
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.match_catalogue_image_vectors(
  halfvec, text, text, text, text, integer
) TO service_role;
