import { searchVectorIndex } from "../vector/search.js";

function clamp01(v){ return Math.max(0,Math.min(1,Number(v||0))); }

export async function searchMultiProbeVectorIndex(
  env,
  config,
  probes,
  {topK,rrfK=20}={}
){
  const rows = Array.isArray(probes) ? probes.slice(0,3) : [];
  if(!rows.length) return [];

  const perProbe=[];
  for(const probe of rows){
    const hits=await searchVectorIndex(
      env,
      config,
      probe.vector,
      topK || config.vector.topK
    );
    perProbe.push({probe_id:probe.probe_id || 'probe',hits});
  }

  const byRecord=new Map();
  const maxRrfPerProbe=1/(rrfK+1);

  for(const {probe_id,hits} of perProbe){
    for(let i=0;i<hits.length;i++){
      const hit=hits[i];
      const id=String(hit?.record_id || '');
      if(!id) continue;
      const sim=clamp01(hit?.similarity);
      const rrf=1/(rrfK+i+1);
      const cur=byRecord.get(id) || {
        ...hit,
        record_id:id,
        best_similarity:0,
        rrf_sum:0,
        probe_ids:new Set(),
        best_hit:hit
      };
      cur.rrf_sum += rrf;
      cur.probe_ids.add(probe_id);
      if(sim > cur.best_similarity){
        cur.best_similarity=sim;
        cur.best_hit=hit;
      }
      byRecord.set(id,cur);
    }
  }

  const probeCount=perProbe.length;
  return [...byRecord.values()].map(row=>{
    const consensus=row.probe_ids.size/probeCount;
    const rrfNorm=clamp01(
      row.rrf_sum / Math.max(1e-9, probeCount*maxRrfPerProbe)
    );
    const similarity=clamp01(
      0.82*row.best_similarity +
      0.12*rrfNorm +
      0.06*consensus
    );
    return {
      ...row.best_hit,
      record_id:row.record_id,
      similarity,
      raw_vector_similarity:row.best_similarity,
      probe_consensus:consensus,
      probe_rrf:rrfNorm,
      probe_count:row.probe_ids.size
    };
  }).sort((a,b)=>b.similarity-a.similarity)
    .slice(0,Math.max(1,Number(topK || config.vector.topK)));
}
