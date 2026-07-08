create or replace function public.match_catalogue_image_vectors(
  p_query_embedding halfvec(384),
  p_embedding_model text,
  p_embedding_model_version text,
  p_preprocess_version text,
  p_embedding_profile text,
  p_match_count integer default 60
)
returns table (
  record_id text,
  asset_type text,
  object_key text,
  similarity double precision
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform set_config('hnsw.ef_search','100',true);

  return query
  select
    v.record_id,
    v.asset_type,
    v.object_key,
    1 - (v.embedding <=> p_query_embedding) as similarity
  from public.catalogue_image_vectors v
  where v.is_active = true
    and v.embedding_model = p_embedding_model
    and v.embedding_model_version = p_embedding_model_version
    and v.preprocess_version = p_preprocess_version
    and v.embedding_profile = p_embedding_profile
  order by v.embedding <=> p_query_embedding
  limit greatest(1,least(coalesce(p_match_count,60),100));
end;
$$;

revoke all on function public.match_catalogue_image_vectors(
  halfvec,text,text,text,text,integer
) from public, anon, authenticated;

grant execute on function public.match_catalogue_image_vectors(
  halfvec,text,text,text,text,integer
) to service_role;
