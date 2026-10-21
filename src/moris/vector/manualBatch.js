export function selectAssets(item,mode){
 return (item.assets||[]).filter(a=>a.image_path && (mode==='replace'||(mode==='stale'?a.vector_status==='stale':(a.vector_status?a.vector_status==='missing':!a.has_vector))));
}
export function onlyLegacyZeroAssets(items){
 return (items||[]).map(item=>({...item,assets:(item.assets||[]).filter(asset=>asset.legacy_hole_zero===true)}));
}
export function previewBatch(items,mode){
 if(!['skip','stale','replace'].includes(mode))throw Error('Invalid batch mode');
 const jobs=items.flatMap(item=>selectAssets(item,mode).map(asset=>({item,asset})));
 const missing=jobs.filter(j=>j.asset.vector_status==='missing'||(!j.asset.vector_status&&!j.asset.has_vector)).length;
 return {jobs,assets:jobs.length,skus:new Set(jobs.map(j=>j.item.id)).size,missing,
  possibly_replaced:jobs.length-missing,new_rows_min:missing,new_rows_max:jobs.length};
}
export function createPauseControl(){
 let paused=false,release=null,pending=null;
 return {get paused(){return paused;},pause(){if(!paused){paused=true;pending=new Promise(r=>release=r);}},resume(){paused=false;release?.();release=null;pending=null;},async wait(){while(paused)await pending;}};
}
export async function runManualBatch({jobs,confirmed,writeAsset,control=createPauseControl(),onProgress=()=>{},retries=1}){
 if(confirmed!==true)throw Error('Explicit confirmation required');
 const results=[];let written=0,skipped=0,failed=0;
 for(const job of jobs){
  await control.wait();let result;
  for(let attempt=0;attempt<=Math.min(2,Math.max(0,retries));attempt++){
   try{
    const response=await writeAsset(job);
    if(response.failed>0||response.written+response.skipped!==1)throw Error('Missing per-asset write evidence');
    result={sku:job.item.code,asset:job.asset.image_path,status:response.skipped?'skipped':'written',attempts:attempt+1};
    written+=response.written;skipped+=response.skipped;break;
   }catch(error){
    const transient=error.name==='TypeError'||error.code==='MORIS_VECTOR_UPSERT_TIMEOUT'||error.status>=500;
    if(transient&&attempt<Math.min(2,Math.max(0,retries))){await control.wait();continue;}
    result={sku:job.item.code,asset:job.asset.image_path,status:'failed',error:error.message,attempts:attempt+1};failed++;break;
   }
  }
  results.push(result);onProgress({completed:results.length,total:jobs.length,written,skipped,failed,result});
 }
 return {written,skipped,failed,results};
}
