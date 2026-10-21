import { searchVectorIndex } from "../vector/search.js";
import { collapseBestVectorHitPerRecord } from "./vectorHitCollapse.js";

const clamp01=v=>Math.max(0,Math.min(1,Number(v)||0));

// RRF consensus is retrieval evidence, never a replacement for raw cosine.
export function fuseProbeHits(perProbe,{topK=60,rrfK=20}={}) {
  const unique=[...new Map(perProbe.map(p=>[p.probe_id,p])).values()];
  const byRecord=new Map();
  for(const {probe_id,hits} of unique){
    const perSku=collapseBestVectorHitPerRecord(hits,{limit:100});
    for(let i=0;i<perSku.length;i++){
      const hit=perSku[i],id=hit.record_id;
      const cur=byRecord.get(id)||{best_hit:hit,rrf_sum:0,probe_ids:[],evidence:[]};
      cur.rrf_sum+=1/(rrfK+i+1);cur.probe_ids.push(probe_id);
      cur.evidence.push(...hit.view_evidence.map(e=>({...e,probe_id})));
      if(hit.similarity>cur.best_hit.similarity)cur.best_hit=hit;
      byRecord.set(id,cur);
    }
  }
  return [...byRecord.values()].map(row=>{
    const consensus=row.probe_ids.length/Math.max(1,unique.length);
    const rrf=clamp01(row.rrf_sum/(Math.max(1,unique.length)/(rrfK+1)));
    return {...row.best_hit,similarity:row.best_hit.similarity,
      raw_vector_similarity:row.best_hit.similarity,
      retrieval_score:clamp01(.82*row.best_hit.similarity+.12*rrf+.06*consensus),
      probe_consensus:consensus,probe_rrf:rrf,probe_count:row.probe_ids.length,
      probe_ids:row.probe_ids,view_evidence:row.evidence};
  }).sort((a,b)=>b.retrieval_score-a.retrieval_score || a.record_id.localeCompare(b.record_id))
    .slice(0,Math.max(1,Math.min(100,topK)));
}

export async function searchMultiProbeVectorIndex(env,config,probes,{topK,rrfK=20,onRpc}={}){
  const perProbe=[];
  const seen=new Set();
  for(const probe of (Array.isArray(probes)?probes:[]).slice(0,3)){
    const fingerprint=JSON.stringify(probe.vector);
    if(seen.has(fingerprint))continue;
    seen.add(fingerprint);
    const hits=await searchVectorIndex(env,config,probe.vector,topK||config.vector.topK,{onRpc});
    perProbe.push({probe_id:probe.probe_id||`probe_${perProbe.length}`,hits});
  }
  return fuseProbeHits(perProbe,{topK:topK||config.vector.topK,rrfK});
}
