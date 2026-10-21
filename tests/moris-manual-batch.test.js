import {describe,it,expect,vi} from 'vitest';
import {selectAssets,onlyLegacyZeroAssets,previewBatch,createPauseControl,runManualBatch} from '../src/moris/vector/manualBatch.js';
const item={id:'a',code:'A',assets:['missing','stale','ready','failed'].map((vector_status,i)=>({image_path:i+'.png',vector_status}))};
const jobs=n=>Array.from({length:n},(_,i)=>({item:{id:String(i),code:String(i)},asset:{image_path:i+'.png'}}));
describe('manual preview/batch control',()=>{
 it('separates missing/stale/rebuild and preview causes no write',()=>{
  expect(selectAssets(item,'skip').map(r=>r.vector_status)).toEqual(['missing']);
  expect(selectAssets(item,'stale').map(r=>r.vector_status)).toEqual(['stale']);
  expect(previewBatch([item],'replace')).toMatchObject({assets:4,skus:1,missing:1,new_rows_min:1,new_rows_max:4});
 });
 it('selects only legacy zero assets for a controlled repair batch',()=>{
  const mixed=[{id:'a',assets:[{image_path:'front.webp',legacy_hole_zero:true},
   {image_path:'thumb.webp',legacy_hole_zero:false}]},{id:'b',assets:[{image_path:'other.webp',legacy_hole_zero:true}]}];
  const selected=onlyLegacyZeroAssets(mixed);
  expect(previewBatch(selected,'replace')).toMatchObject({assets:2,skus:2});
  expect(selected[0].assets.map(a=>a.image_path)).toEqual(['front.webp']);
  expect(mixed[0].assets).toHaveLength(2);
 });
 it('0jobs does nothing and unconfirmed1job rejects before work',async()=>{
  const writeAsset=vi.fn();expect(await runManualBatch({jobs:[],confirmed:true,writeAsset})).toMatchObject({written:0,failed:0});
  await expect(runManualBatch({jobs:jobs(1),confirmed:false,writeAsset})).rejects.toThrow(/confirmation/);expect(writeAsset).not.toHaveBeenCalled();
 });
 it('handles21assets sequentially and retries timeout idempotently',async()=>{
  let first=true;const writeAsset=vi.fn(async()=>{if(first){first=false;const e=Error('timeout');e.code='MORIS_VECTOR_UPSERT_TIMEOUT';throw e;}return {written:0,skipped:1,failed:0};});
  const r=await runManualBatch({jobs:jobs(21),confirmed:true,writeAsset});expect(r).toMatchObject({skipped:21,failed:0});expect(writeAsset).toHaveBeenCalledTimes(22);expect(r.results[0].attempts).toBe(2);
 });
 it('pause prevents next asset; resume does not replay completed asset',async()=>{
  const control=createPauseControl(),writeAsset=vi.fn(async()=>({written:1,skipped:0,failed:0}));
  const work=runManualBatch({jobs:jobs(2),confirmed:true,control,writeAsset,onProgress:({completed})=>{if(completed===1)control.pause();}});
  await new Promise(setImmediate);expect(writeAsset).toHaveBeenCalledTimes(1);control.resume();expect((await work).written).toBe(2);expect(writeAsset).toHaveBeenCalledTimes(2);
 });
 it('409 is an explicit per-asset failure, subsequent assets continue',async()=>{
  const writeAsset=vi.fn(async({item})=>{if(item.id==='0')throw Object.assign(Error('duplicate needs refresh'),{status:409});return {written:1,skipped:0,failed:0};});
  const r=await runManualBatch({jobs:jobs(2),confirmed:true,writeAsset});expect(r).toMatchObject({written:1,failed:1});expect(writeAsset).toHaveBeenCalledTimes(2);expect(r.results[0]).toMatchObject({status:'failed',attempts:1});
 });
});
