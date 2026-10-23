import {describe,it,expect,vi} from 'vitest';
import { classifyAsset, summarizeAssets, geometryWarning, isLegacyZeroGeometry, inspectVectorItems } from '../functions/_lib/moris/v5/vector/assetStatus.js';
const profile={model:'test',modelVersion:'1',preprocessVersion:'1',profile:'cls'};
const asset={asset_type:'front',image_path:'a.webp'};
const vector={asset_type:'front',object_key:'a.webp',is_active:true,view_variant:'canon_rgb_v2',embedding_model:'test',embedding_model_version:'1',preprocess_version:'1',embedding_profile:'cls',source_etag:'"v1"'};
const options={etag:'"v1"',currentKeys:['a.webp']};
describe('M05 asset freshness',()=>{
 it('missing index is missing',()=>expect(classifyAsset(asset,[],profile,options).vector_status).toBe('missing'));
 it('matching profile and measured ETag is ready',()=>expect(classifyAsset(asset,[vector],profile,options).vector_status).toBe('ready'));
 it.each([{source_etag:null},{source_etag:'"old"'},{embedding_profile:'other'},{view_variant:'canon_gray_v2'},{object_key:'old.webp'}])('stale evidence %j',change=>expect(classifyAsset(asset,[{...vector,...change}],profile,options).vector_status).toBe('stale'));
 it('same key content change is stale regardless of metadata date',()=>expect(classifyAsset(asset,[vector],profile,{...options,etag:'"v2"'}).vector_reason).toBe('source_changed'));
 it('unknown source version never becomes ready',()=>expect(classifyAsset(asset,[vector],profile,{}).vector_status).toBe('failed'));
 it('unchecked source version is unverified, not failed',()=>expect(classifyAsset(asset,[vector],profile,{...options,etag:undefined,headChecked:false})).toMatchObject({vector_status:'unverified',vector_reason:'source_version_unchecked'}));
 it('missing index without an ETag is still missing',()=>expect(classifyAsset(asset,[],profile,{etag:undefined,currentKeys:['a.webp']})).toMatchObject({vector_status:'missing',vector_reason:'no_vector'}));
 it('old profile without an ETag is stale, not unavailable',()=>expect(classifyAsset(asset,[{...vector,embedding_profile:'other'}],profile,{etag:undefined,currentKeys:['a.webp']})).toMatchObject({vector_status:'stale',vector_reason:'profile_or_variant_changed'}));
 it('read failure never pretends missing',()=>expect(classifyAsset(asset,[],profile,{...options,failed:true}).vector_status).toBe('failed'));
 it('sibling current detail is not stale evidence for a new detail',()=>expect(classifyAsset({...asset,asset_type:'detail'},[{...vector,asset_type:'detail',object_key:'b.webp'}],profile,{...options,currentKeys:['a.webp','b.webp']}).vector_status).toBe('missing'));
 it('one ready view cannot mark an incomplete SKU ready',()=>expect(summarizeAssets([{vector_status:'ready'},{vector_status:'missing'}])).toBe('partial'));
 it('failed reads are surfaced on the SKU',()=>expect(summarizeAssets([{vector_status:'ready'},{vector_status:'failed'}])).toBe('failed'));
 it('unverified source reads are not reported as pending',()=>expect(summarizeAssets([{vector_status:'ready'},{vector_status:'unverified'}])).toBe('unverified'));
 it('unverified cannot hide a confirmed missing or stale asset',()=>{
  expect(summarizeAssets([{vector_status:'missing'},{vector_status:'unverified'}])).toBe('partial');
  expect(summarizeAssets([{vector_status:'stale'},{vector_status:'unverified'}])).toBe('stale');
 });
 it('warns that legacy zero/default geometry is ambiguous',()=>{
  const old={...vector,source_etag:null,hole_count:0,aspect_ratio:1,hole_centroids:[]};
  expect(classifyAsset(asset,[old],profile,options).geometry_warning).toBe('legacy_geometry_ambiguous');
  expect(classifyAsset(asset,[old],profile,options).legacy_hole_zero).toBe(true);
  expect(geometryWarning(old)).toBe('legacy_geometry_ambiguous');
  expect(isLegacyZeroGeometry({...old,hole_count:2})).toBe(false);
  expect(isLegacyZeroGeometry({...old,geometry_evidence:{quality:{reliable:true}}})).toBe(false);
 });
 it('keeps the repair marker when source version is unknown',()=>{
  const old={...vector,source_etag:null,hole_count:0,aspect_ratio:1,hole_centroids:[]};
  expect(classifyAsset(asset,[old],profile,{currentKeys:['a.webp']})).toMatchObject({
   vector_status:'stale',vector_reason:'source_version_unknown',legacy_hole_zero:true
  });
 });
 it('accepts complete measured zero with provenance and empty centroids',()=>{
  expect(geometryWarning({...vector,hole_count:0,aspect_ratio:2,hole_centroids:[],geometry_evidence:{quality:{reliable:true}}})).toBeNull();
 });
 it('warns when provenance lacks count or centroid evidence',()=>{
  expect(geometryWarning({...vector,hole_count:null,aspect_ratio:null,hole_centroids:null,geometry_evidence:{quality:{reliable:false}}})).toBe('geometry_incomplete');
 });
 it('checks every asset on a page with more than 40 assets',async()=>{
  const original=globalThis.fetch;
  const recordId='part-many';
  const assets=Array.from({length:49},(_,i)=>({asset_type:i===0?'front':'detail',image_path:`many/${i}.webp`}));
  const vectors=assets.map((a,i)=>({...vector,record_id:recordId,asset_type:a.asset_type,object_key:a.image_path,source_etag:`"v${i}"`}));
  globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify(vectors),{status:200}));
  const heads=[];
  const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test',
   MORIS_VECTOR_MODEL:'test',MORIS_VECTOR_MODEL_VERSION:'1',MORIS_PREPROCESS_VERSION:'1',MORIS_EMBEDDING_PROFILE:'cls',
   CATALOGUE_BUCKET:{head:async key=>{heads.push(key);return {httpEtag:`"v${assets.findIndex(a=>a.image_path===key)}"`};}}};
  try {
   const result=await inspectVectorItems(env,[{id:recordId,assets}]);
   expect(heads).toHaveLength(49);
   expect(result[0].assets.every(a=>a.vector_status==='ready')).toBe(true);
   expect(result[0].vector_status).toBe('ready');
  } finally {globalThis.fetch=original;}
 });
 it('marks assets beyond the R2 budget unverified instead of failed',async()=>{
  const original=globalThis.fetch;
  const assets=Array.from({length:121},(_,i)=>({asset_type:'front',image_path:`budget/${i}.webp`}));
  const vectors=assets.map((a,i)=>({...vector,record_id:'part-budget',object_key:a.image_path,source_etag:`"v${i}"`}));
  globalThis.fetch=vi.fn(async()=>new Response(JSON.stringify(vectors),{status:200}));
  let heads=0;
  const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test',
   MORIS_VECTOR_MODEL:'test',MORIS_VECTOR_MODEL_VERSION:'1',MORIS_PREPROCESS_VERSION:'1',MORIS_EMBEDDING_PROFILE:'cls',
   CATALOGUE_BUCKET:{head:async key=>{heads+=1;return {httpEtag:`"v${assets.findIndex(a=>a.image_path===key)}"`};}}};
  try {
   const result=await inspectVectorItems(env,[{id:'part-budget',assets}]);
   expect(heads).toBe(120);
   expect(result[0].assets.slice(0,120).every(a=>a.vector_status==='ready')).toBe(true);
   expect(result[0].assets[120]).toMatchObject({vector_status:'unverified',vector_reason:'source_version_unchecked'});
   expect(result[0].vector_status).toBe('unverified');
  } finally {globalThis.fetch=original;}
 });
 it('reads legacy schema without source_etag and flags ambiguous geometry',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=vi.fn(async url=>{
   const select=new URL(String(url)).searchParams.get('select');calls.push(select);
   if(select.includes('source_etag'))return new Response(JSON.stringify({code:'42703'}),{status:400});
   return new Response(JSON.stringify([{...vector,record_id:'part-1',embedding_model:'onnx-community/dinov2-small',
    embedding_model_version:'ef1fb10',preprocess_version:'kim_canon_v3_letterbox',
    embedding_profile:'hybrid_gem3_edge_55_45_pseudorgb_u8_v1',source_etag:undefined,
    hole_count:0,aspect_ratio:1,hole_centroids:[]}]),{status:200});
  });
  try {
   const result=await inspectVectorItems({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test',
    CATALOGUE_BUCKET:{head:async()=>({httpEtag:'"v1"'})}},[{id:'part-1',assets:[asset]}]);
   expect(calls).toHaveLength(2);
   expect(result[0].assets[0]).toMatchObject({vector_status:'stale',geometry_warning:'legacy_geometry_ambiguous'});
  } finally {globalThis.fetch=original;}
 });
});
