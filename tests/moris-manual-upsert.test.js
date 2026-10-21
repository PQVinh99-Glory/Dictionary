import { describe,it,expect,vi,afterEach } from 'vitest';
import { onRequestPost } from '../functions/api/moris/vector-upsert.js';
import { MORIS_DINOV2_PROFILE as profile } from '../src/moris/vector/browserDinov2.js';
import { upsertVectorsChunked } from '../src/moris/vector/chunkedUpsert.js';
const env={SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test',CATALOGUE_BUCKET:{head:async()=>({httpEtag:'"v1"'})}};
const vector=(extra={})=>({record_id:'part',asset_type:'front',object_key:'p.webp',view_variant:'canon_rgb_v2',geometry:{geometry_version:'geometry_v1',quality:{reliable:true},hole_count:0,aspect_ratio:2},embedding_profile:profile,embedding:Array(384).fill(0.1),source_etag:'"v1"',...extra});
afterEach(()=>vi.unstubAllGlobals());
async function send(vectors,extra={}) { return onRequestPost({env,request:new Request('https://example.test/upsert',{method:'POST',body:JSON.stringify({session_token:'a.b.c',source:'vector_center',confirmed:true,mode:'skip',vectors,...extra})})}); }
function database() {
 const rows=new Map(); const calls=[];
 vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
  if(url.endsWith('app_me')) return Response.json({ok:true,role_name:'editor'});
  expect(url).toContain('/rpc/kim_write_catalogue_vector_v6');
  const {p_vector:v,p_mode:mode}=JSON.parse(options.body); calls.push({v,mode});
  if(v.p_object_key==='bad.webp') return Response.json({message:'DB failed'},{status:500});
  const key=JSON.stringify([v.p_record_id,v.p_asset_type,v.p_object_key,v.p_view_variant,v.p_embedding_model,v.p_embedding_model_version,v.p_preprocess_version,v.p_embedding_profile]);
  const exists=rows.has(key); if(!exists) rows.set(key,rows.size+1);
  return Response.json({id:rows.get(key),action:exists?(mode==='skip'?'skipped':'replaced'):'created'});
 })); return {rows,calls};
}
describe('M04 manual write contract (mock transport; SQL separately tested)',()=>{
 it('same request skips on retry and replace retains ID/row count',async()=>{
  const db=database();const first=await (await send([vector()])).json();
  const repeat=await (await send([vector()])).json();const replace=await (await send([vector()],{mode:'replace'})).json();
  expect(first.written).toBe(1);expect(repeat).toMatchObject({written:0,skipped:1,failed:0});expect(replace.written).toBe(1);expect(db.rows.size).toBe(1);
 });
 it('distinct assets and object keys are transmitted without broad duplicate filtering',async()=>{
  const db=database();const res=await send([vector(),vector({asset_type:'thumb'}),vector({object_key:'other.webp'})]);
  expect(res.status).toBe(200);expect(db.rows.size).toBe(3);
 });
 it('gray is disabled at the public write boundary',async()=>{
  const db=database();const res=await send([vector({view_variant:'canon_gray_v2'})]);expect(res.status).toBe(502);expect(db.calls).toHaveLength(0);
 });
 it('unknown/unreliable geometry cannot be silently persisted as zero',async()=>{
  const db=database();const data=await (await send([vector({geometry:{hole_count:0,quality:{reliable:false}}})])).json();
  expect(data).toMatchObject({ok:false,written:0,failed:1});expect(db.calls).toHaveLength(0);
 });
 it('versioned unknown geometry is explicitly nullable in the new RPC',async()=>{
  const db=database();const data=await(await send([vector({geometry:{geometry_version:'geometry_v1',quality:{reliable:false},hole_count:8,aspect_ratio:2,patch_signature:{large:'not persisted'}}})])).json();
  expect(data.written).toBe(1);expect(db.calls[0].v.geometry_evidence).toMatchObject({hole_count:null,aspect_ratio:null});
  expect(db.calls[0].v.geometry_evidence.patch_signature).toBeUndefined();
 });
 it('rejects zero, numeric-string and null embedding components before SQL',async()=>{
  for(const embedding of [Array(384).fill(0),Array(384).fill('0.1'),Array(384).fill(null)]){
   const db=database();const data=await(await send([vector({embedding})])).json();expect(data.failed).toBe(1);expect(db.calls).toHaveLength(0);
  }
 });
 it('source changed since embedding is rejected before SQL',async()=>{
  const db=database();expect((await send([vector({source_etag:'"old"'})])).status).toBe(502);expect(db.calls).toHaveLength(0);
 });
 it('partial errors are not reported as complete success',async()=>{
  database();const data=await (await send([vector(),vector({object_key:'bad.webp'})])).json();
  expect(data).toMatchObject({ok:false,written:1,failed:1});
 });
 it('more than 20 rows rejects without writes',async()=>{
  const db=database();expect((await send(Array.from({length:21},()=>vector()))).status).toBe(413);expect(db.calls).toHaveLength(0);
 });
 it('chunked writes count skipped rows and preserve explicit intent',async()=>{
  const fetchImpl=vi.fn(async(_,opts)=>{const body=JSON.parse(opts.body);expect(body).toMatchObject({source:'vector_center',confirmed:true,mode:'skip'});expect(body.vectors.length).toBeLessThanOrEqual(20);return Response.json({ok:true,written:0,skipped:body.vectors.length,failed:0});});
  const result=await upsertVectorsChunked({vectors:Array.from({length:21},()=>vector()),confirmed:true,fetchImpl});
  expect(result).toMatchObject({written:0,skipped:21,chunks:2});
 });
 it('fails closed when v6 provenance RPC is missing instead of writing false zero through legacy RPC',async()=>{
  let fallbackCalled=false;
  vi.stubGlobal('fetch',vi.fn(async(url,options)=>{
   if(url.endsWith('app_me')) return Response.json({ok:true,role_name:'editor'});
   if(url.includes('/rpc/kim_write_catalogue_vector_v6_provenance')) {
    return Response.json({
     code:'PGRST202',
     message:'Could not find the function public.kim_write_catalogue_vector_v6_provenance(p_mode, p_vector) in the schema cache'
    },{status:404});
   }
   if(url.includes('/rpc/kim_upsert_catalogue_image_vector')) {
    fallbackCalled=true;
    const body=JSON.parse(options.body);
    expect(body.p_record_id).toBe('part');
    return Response.json(999);
   }
   return Response.json({message:'not found'},{status:404});
  }));
  const res=await send([vector()]);
  const data=await res.json();
  expect(fallbackCalled).toBe(false);
  expect(data).toMatchObject({ok:false,written:0,failed:1});
 });
});
