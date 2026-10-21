import { baseUrl, serverKey, headersForKey } from '../connectors/supabaseService.js';
import { readMorisConfig } from '../runtime/config.js';

export function geometryWarning(vector) {
  if (!vector) return null;
  if (vector.geometry_evidence) {
    const g=vector.geometry_evidence;
    return g.quality?.reliable === true && Number.isInteger(vector.hole_count) &&
      Number.isFinite(vector.aspect_ratio) && vector.aspect_ratio > 0 &&
      Array.isArray(vector.hole_centroids) && vector.hole_centroids.length === vector.hole_count
      ? null : 'geometry_incomplete';
  }
  // Legacy zero/1/[] are database defaults, not proof of a hole-free square part.
  return vector.hole_count === 0 || vector.aspect_ratio === 1 ||
    !Array.isArray(vector.hole_centroids) || vector.hole_centroids.length === 0
    ? 'legacy_geometry_ambiguous' : null;
}

export function isLegacyZeroGeometry(vector) {
  return !!vector && !vector.geometry_evidence && vector.hole_count === 0 &&
    vector.aspect_ratio === 1 && Array.isArray(vector.hole_centroids) &&
    vector.hole_centroids.length === 0;
}

export function classifyAsset(asset, vectors, profile, { etag, failed = false, currentKeys = [] } = {}) {
  if (failed) return { vector_status:'failed', vector_reason:'source_or_index_unavailable' };
  const key=String(asset.image_path || '').replace(/^\/+/, '');
  const sameType=vectors.filter(v=>v.asset_type===asset.asset_type && v.is_active);
  const source=sameType.filter(v=>v.object_key===key);
  const exact=source.find(v=>v.view_variant==='canon_rgb_v2' && v.embedding_model===profile.model &&
    v.embedding_model_version===profile.modelVersion && v.preprocess_version===profile.preprocessVersion && v.embedding_profile===profile.profile);
  if (exact) {
    const warning=geometryWarning(exact);
    const legacy_hole_zero=isLegacyZeroGeometry(exact);
    if (!etag) return {vector_status:'failed',vector_reason:'source_or_index_unavailable',geometry_warning:warning,legacy_hole_zero};
    if (!exact.source_etag) return {vector_status:'stale',vector_reason:'source_version_unknown',geometry_warning:warning,legacy_hole_zero};
    return exact.source_etag===etag ? {vector_status:'ready',vector_reason:'profile_and_source_match',geometry_warning:warning,legacy_hole_zero} : {vector_status:'stale',vector_reason:'source_changed',geometry_warning:warning,legacy_hole_zero};
  }
  if (!etag) return {vector_status:'failed',vector_reason:'source_or_index_unavailable'};
  if (source.length) return {vector_status:'stale',vector_reason:'profile_or_variant_changed'};
  if (sameType.some(v=>!currentKeys.includes(v.object_key))) return {vector_status:'stale',vector_reason:'source_key_changed'};
  return {vector_status:'missing',vector_reason:'no_vector'};
}

export function summarizeAssets(assets) {
  const states=assets.map(a=>a.vector_status);
  if (!states.length || states.every(s=>s==='missing')) return 'missing';
  if (states.every(s=>s==='ready')) return 'ready';
  if (states.includes('failed')) return 'failed';
  if (new Set(states).size>1) return 'partial';
  return 'stale';
}

export async function inspectVectorItems(env, items) {
  const profile=readMorisConfig(env).vector;
  const vectors=[];
  let failed=false;
  try {
    const key=serverKey(env), base=baseUrl(env);
    if (!key || !base) throw new Error('Missing server configuration');
    // Bound each REST filter and paginate; never infer missing from a truncated list.
    for(let start=0;start<items.length;start+=50) {
      const ids=items.slice(start,start+50).map(i=>'"'+String(i.id).replaceAll('\\','\\\\').replaceAll('"','\\"')+'"');
      for(let offset=0;;offset+=1000) {
        const params={record_id:`in.(${ids.join(',')})`,is_active:'eq.true',order:'id.asc',limit:'1000',offset:String(offset)};
        const fields='record_id,asset_type,object_key,view_variant,embedding_model,embedding_model_version,preprocess_version,embedding_profile,is_active,hole_count,aspect_ratio,hole_centroids';
        const request=select=>fetch(`${base}/rest/v1/catalogue_image_vectors?${new URLSearchParams({...params,select})}`,{headers:headersForKey(key)});
        let res=await request(`${fields},source_etag,geometry_evidence`);
        if(!res.ok) {
          const error=await res.json().catch(()=>({}));
          if(res.status!==400 || error.code!=='42703') throw new Error('Vector metadata unavailable');
          res=await request(fields);
        }
        if(!res.ok) throw new Error('Vector metadata unavailable');
        const rows=await res.json();if(!Array.isArray(rows)) throw new Error('Invalid vector metadata');
        vectors.push(...rows);if(rows.length<1000) break;
      }
    }
  } catch (_) { failed=true; }
  const jobs=items.flatMap(item=>(item.assets || []).map(asset=>({item,asset})));
  jobs.forEach((job,index)=>{job.index=index;});
  // R2 head is read-only and returns the current content ETag, not metadata timestamps.
  for(let start=0;start<jobs.length;start+=8) {
    await Promise.all(jobs.slice(start,start+8).map(async({item,asset,index})=>{
      let etag=null;
      try { if(!failed && index < 40) etag=(await env.CATALOGUE_BUCKET?.head(String(asset.image_path || '').replace(/^\/+/,'')))?.httpEtag; } catch(_) {}
      const rows=vectors.filter(v=>String(v.record_id)===String(item.id));
      Object.assign(asset,classifyAsset(asset,rows,profile,{etag,failed,currentKeys:(item.assets || []).filter(a=>a.asset_type===asset.asset_type).map(a=>String(a.image_path).replace(/^\/+/,''))}));
    }));
  }
  return items.map(item=>({...item,vector_status:item.assets_unavailable ? "failed" : summarizeAssets(item.assets || [])}));
}
