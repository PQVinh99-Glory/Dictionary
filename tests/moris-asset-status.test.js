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
 it('read failure never pretends missing',()=>expect(classifyAsset(asset,[],profile,{...options,failed:true}).vector_status).toBe('failed'));
 it('sibling current detail is not stale evidence for a new detail',()=>expect(classifyAsset({...asset,asset_type:'detail'},[{...vector,asset_type:'detail',object_key:'b.webp'}],profile,{...options,currentKeys:['a.webp','b.webp']}).vector_status).toBe('missing'));
 it('one ready view cannot mark an incomplete SKU ready',()=>expect(summarizeAssets([{vector_status:'ready'},{vector_status:'missing'}])).toBe('partial'));
 it('failed reads are surfaced on the SKU',()=>expect(summarizeAssets([{vector_status:'ready'},{vector_status:'failed'}])).toBe('failed'));
 it('warns that legacy zero/default geometry is ambiguous',()=>{
  const old={...vector,source_etag:null,hole_count:0,aspect_ratio:1,hole_centroids:[]};
  expect(classifyAsset(asset,[old],profile,options).geometry_warning).toBe('legacy_geometry_ambiguous');
  expect(classifyAsset(asset,[old],profile,options).legacy_hole_zero).toBe(true);
  expect(geometryWarning(old)).toBe('legacy_geometry_ambiguous');
  expect(isLegacyZeroGeometry({...old,hole_count:2})).toBe(false);
  expect(isLegacyZeroGeometry({...old,geometry_evidence:{quality:{reliable:true}}})).toBe(false);
 });
 it('keeps the repair marker when an R2 HEAD was not attempted',()=>{
  const old={...vector,source_etag:null,hole_count:0,aspect_ratio:1,hole_centroids:[]};
  expect(classifyAsset(asset,[old],profile,{currentKeys:['a.webp']})).toMatchObject({
   vector_status:'failed',legacy_hole_zero:true
  });
 });
 it('accepts complete measured zero with provenance and empty centroids',()=>{
  expect(geometryWarning({...vector,hole_count:0,aspect_ratio:2,hole_centroids:[],geometry_evidence:{quality:{reliable:true}}})).toBeNull();
 });
 it('warns when provenance lacks count or centroid evidence',()=>{
  expect(geometryWarning({...vector,hole_count:null,aspect_ratio:null,hole_centroids:null,geometry_evidence:{quality:{reliable:false}}})).toBe('geometry_incomplete');
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
