import { normalizeGeometry } from "../schemas/geometry.js";
import { rpc, searchCatalogue, scanCatalogue } from "./supabase.js";

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function filterVisibleCatalogueIds(env,token,recordIds,filters={}){
  const ids=[...new Set((recordIds||[]).map(String))];
  if(!ids.length)return {status:'complete',ids:[]};
  if(ids.length>2000||!ids.every(id=>UUID_PATTERN.test(id)))return {status:'invalid_scope',ids:[]};
  try{
    const rows=await rpc(env,'app_filter_catalogue_ids_moris_v1',{
      p_session_token:token,p_record_ids:ids,
      p_usage_side:filters.usage_side||'all',p_view_mode:filters.view_mode||'all'
    });
    if(!Array.isArray(rows))return {status:'invalid_response',ids:[]};
    const requested=new Set(ids);
    return {status:'complete',ids:[...new Set(rows.map(row=>String(row?.id||'')))].filter(id=>requested.has(id))};
  }catch(error){
    return {status:'unavailable',ids:[],code:String(error?.status||error?.code||'RPC_ERROR')};
  }
}

export async function exactLookup(env, token, query) {
  const q = norm(query?.message);
  if (!q) return [];

  const rows = await searchCatalogue(env, token, {
    search:q,
    usageSide:query?.filters?.usage_side || "all",
    viewMode:query?.filters?.view_mode || "all",
    limit:20,
    offset:0
  });

  return rows.filter(row =>
    [row?.code, row?.part_id, row?.id]
      .some(v => norm(v) === q)
  );
}

export async function hydrateVectorHits(env, token, hits, {maxRows=1500,filters={},keyed=false,onStatus}={}) {
  let all = null;
  if (keyed) {
    const ids=[...new Set((hits||[]).map(hit=>String(hit.record_id||'')))];
    if (ids.length && ids.every(id=>UUID_PATTERN.test(id))) {
      try {
        all=[];
        for(let i=0;i<ids.length;i+=100){
          const page=await rpc(env,'app_get_catalogue_by_ids_moris_v1',{
            p_session_token:token,
            p_record_ids:ids.slice(i,i+100),
            p_usage_side:filters.usage_side||'all',
            p_view_mode:filters.view_mode||'all'
          });
          if(!Array.isArray(page))throw new Error('Invalid keyed hydration response');
          all.push(...page);
        }
        onStatus?.({status:'keyed',requested:ids.length,returned:all.length});
      } catch(error){
        all=null;
        onStatus?.({status:'keyed_unavailable',code:String(error?.status||error?.code||'RPC_ERROR')});
      }
    } else onStatus?.({status:'invalid_record_ids'});
  }
  // Compatibility fallback until the reviewed RPC is deployed. Full-scan budget
  // errors are surfaced by scanCatalogue; never treat partial scan as complete.
  if(all==null){
    all=await scanCatalogue(env, token, {maxRows,usageSide:filters.usage_side||"all",viewMode:filters.view_mode||"all"});
    onStatus?.({status:'scan_fallback',returned:all.length});
  }
  const byId = new Map(all.map(row => [String(row?.id ?? ""), row]));

  // LỌC BỎ ORPHAN VECTORS: các vector có record_id không còn tồn tại trong
  // catalogue (bản ghi đã bị xóa nhưng vector chưa được dọn).
  // Nếu không lọc, chúng tạo candidate rỗng → UI hiển thị "ID: --- · Chưa xác định".
  return (hits || [])
    .filter(hit => {
      const row=byId.get(String(hit.record_id));
      return row && (!filters.usage_side || filters.usage_side==='all' || row.usage_side===filters.usage_side) &&
        (!filters.view_mode || filters.view_mode==='all' || row.view_mode===filters.view_mode);
    })
    .map(hit => {
      const row = byId.get(String(hit.record_id));
      const geometry = normalizeGeometry(hit);
      return {
        ...row,
        id:row?.id ?? hit.record_id,
        record_id:String(hit.record_id),
        vector_similarity:Number(hit.raw_vector_similarity ?? hit.similarity ?? 0),
        retrieval_score:hit.retrieval_score ?? null,
        view_evidence:hit.view_evidence || [],
        retrieval_channels:hit.retrieval_channels || [],
        probe_ids:hit.probe_ids || [],
        raw_vector_similarity:Number(hit.raw_vector_similarity ?? hit.similarity ?? 0),
        probe_consensus:Number(hit.probe_consensus ?? 0),
        probe_rrf:Number(hit.probe_rrf ?? 0),
        probe_count:Number(hit.probe_count ?? 1),
        vector_object_key:hit.object_key || "",
        vector_asset_type:hit.asset_type || "",
        best_view_evidence:{asset_type:hit.asset_type||null,object_key:hit.object_key||null,raw_similarity:hit.raw_vector_similarity??hit.similarity,selection:"highest_raw_cosine"},
        hole_count:geometry.hole_count,
        aspect_ratio:geometry.aspect_ratio,
        hole_centroids:geometry.hole_centroids,
        contour_signature:geometry.contour_signature || null,
        geometry_version:geometry.geometry_version,
        quality:geometry.quality,
        provenance:geometry.provenance
      };
    });
}
