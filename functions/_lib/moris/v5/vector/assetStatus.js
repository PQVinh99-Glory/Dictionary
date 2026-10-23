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

function exactVectorFor(asset, vectors, profile) {
  const key=String(asset.image_path || '').replace(/^\/+/, '');
  return vectors.find(v=>v.asset_type===asset.asset_type && v.is_active && v.object_key===key &&
    v.view_variant==='canon_rgb_v2' && v.embedding_model===profile.model &&
    v.embedding_model_version===profile.modelVersion && v.preprocess_version===profile.preprocessVersion &&
    v.embedding_profile===profile.profile);
}

export function classifyAsset(asset, vectors, profile, { etag, failed = false, currentKeys = [], headChecked = true } = {}) {
  if (failed) return { vector_status:'failed', vector_reason:'source_or_index_unavailable' };
  const key=String(asset.image_path || '').replace(/^\/+/, '');
  const sameType=vectors.filter(v=>v.asset_type===asset.asset_type && v.is_active);
  const source=sameType.filter(v=>v.object_key===key);
  const exact=exactVectorFor(asset, sameType, profile);
  if (exact) {
    const warning=geometryWarning(exact);
    const legacy_hole_zero=isLegacyZeroGeometry(exact);
    if (!exact.source_etag) return {vector_status:'stale',vector_reason:'source_version_unknown',geometry_warning:warning,legacy_hole_zero};
    if (!headChecked) return {vector_status:'unverified',vector_reason:'source_version_unchecked',geometry_warning:warning,legacy_hole_zero};
    if (!etag) return {vector_status:'failed',vector_reason:'source_or_index_unavailable',geometry_warning:warning,legacy_hole_zero};
    return exact.source_etag===etag ? {vector_status:'ready',vector_reason:'profile_and_source_match',geometry_warning:warning,legacy_hole_zero} : {vector_status:'stale',vector_reason:'source_changed',geometry_warning:warning,legacy_hole_zero};
  }
  if (source.length) return {vector_status:'stale',vector_reason:'profile_or_variant_changed'};
  if (sameType.some(v=>!currentKeys.includes(v.object_key))) return {vector_status:'stale',vector_reason:'source_key_changed'};
  return {vector_status:'missing',vector_reason:'no_vector'};
}

export function summarizeAssets(assets) {
  const states=assets.map(a=>a.vector_status);
  if (!states.length) return 'missing';
  if (states.includes('failed')) return 'failed';
  if (states.every(s=>s==='unverified')) return 'unverified';
  const known=states.filter(s=>s!=='unverified');
  if (!known.length) return 'unverified';
  if (known.every(s=>s==='missing')) return states.length===known.length ? 'missing' : 'partial';
  if (known.every(s=>s==='ready')) return states.length===known.length ? 'ready' : 'unverified';
  if (new Set(known).size>1) return 'partial';
  return 'stale';
}

const R2_HEAD_BUDGET = 120;
const R2_HEAD_CONCURRENCY = 6;

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

  const vectorsByRecord=new Map();
  for(const vector of vectors) {
    const recordId=String(vector.record_id);
    if(!vectorsByRecord.has(recordId)) vectorsByRecord.set(recordId,[]);
    vectorsByRecord.get(recordId).push(vector);
  }
  const jobs=items.flatMap(item=>(item.assets || []).map(asset=>({item,asset})));
  let headBudget=R2_HEAD_BUDGET;
  for(const job of jobs) {
    const rows=vectorsByRecord.get(String(job.item.id)) || [];
    const exact=exactVectorFor(job.asset, rows, profile);
    const needsSourceCheck=!!exact?.source_etag;
    job.needsSourceCheck=needsSourceCheck;
    job.shouldHead=needsSourceCheck && !failed && headBudget>0;
    if(job.shouldHead) headBudget-=1;
  }
  // R2 head is read-only and returns the current content ETag, not metadata timestamps.
  for(let start=0;start<jobs.length;start+=R2_HEAD_CONCURRENCY) {
    await Promise.all(jobs.slice(start,start+R2_HEAD_CONCURRENCY).map(async({item,asset,needsSourceCheck,shouldHead})=>{
      let etag=null;
      if(shouldHead) {
        try { etag=(await env.CATALOGUE_BUCKET?.head(String(asset.image_path || '').replace(/^\/+/,'')))?.httpEtag; } catch(_) {}
      }
      const rows=vectorsByRecord.get(String(item.id)) || [];
      Object.assign(asset,classifyAsset(asset,rows,profile,{
        etag,
        failed,
        headChecked:!needsSourceCheck || shouldHead,
        currentKeys:(item.assets || []).filter(a=>a.asset_type===asset.asset_type).map(a=>String(a.image_path).replace(/^\/+/,''))
      }));
    }));
  }
  return items.map(item=>({...item,vector_status:item.assets_unavailable ? "failed" : summarizeAssets(item.assets || [])}));
}
