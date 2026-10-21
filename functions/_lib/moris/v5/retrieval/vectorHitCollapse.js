export function collapseBestVectorHitPerRecord(hits,{limit=100}={}){
  const byRecord=new Map();
  for(const hit of hits||[]){
    const id=String(hit?.record_id||'');
    const similarity=Number(hit?.raw_vector_similarity??hit?.similarity);
    if(!id || !Number.isFinite(similarity) || similarity < -1 || similarity > 1)continue;
    const current=byRecord.get(id);
    const evidence=Array.isArray(hit.view_evidence)?hit.view_evidence:[{
      asset_type:hit.asset_type,object_key:hit.object_key,similarity,
      hole_count:hit.hole_count??null,aspect_ratio:hit.aspect_ratio??null,
      hole_centroids:hit.hole_centroids??null,
      geometry_version:hit.geometry_version??null,quality:hit.quality??null
    }];
    const best=!current || similarity>current.similarity?{...hit,record_id:id,similarity}:current;
    const merged=[...(current?.view_evidence||[]),...evidence];
    const distinct=[...new Map(merged.map(e=>[JSON.stringify([e.probe_id,e.asset_type,e.object_key,e.similarity]),e])).values()];
    const channels=[...new Set([...(current?.retrieval_channels||[]),...(hit.retrieval_channels||[])])];
    byRecord.set(id,{...best,view_evidence:distinct,retrieval_channels:channels});
  }
  return [...byRecord.values()].sort((a,b)=>(b.retrieval_score??b.similarity)-(a.retrieval_score??a.similarity)||a.record_id.localeCompare(b.record_id))
    .slice(0,Math.max(1,Math.min(100,Number(limit)||100)));
}
