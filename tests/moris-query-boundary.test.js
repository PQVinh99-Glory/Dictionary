import {it,expect} from 'vitest';
import {validateMorisQuery,normalizeCaptureQuality} from '../functions/_lib/moris/v5/schemas/query.js';
import {readMorisConfig} from '../functions/_lib/moris/v5/runtime/config.js';
const config=readMorisConfig({});
it('rejects malformed JSON vector values before coercion can manufacture valid evidence',()=>{
 for(const value of [null,'0.1',true,NaN,Infinity]){
  const embedding=Array(384).fill(.1);embedding[3]=value;
  expect(()=>validateMorisQuery({query_embedding:embedding},config)).toThrow(/không hợp lệ/);
  expect(()=>validateMorisQuery({query_embeddings:[{embedding}]},config)).toThrow(/không hợp lệ/);
 }
 expect(()=>validateMorisQuery({query_embedding:Array(384).fill(0)},config)).toThrow(/zero/);
});
it('preserves valid finite vectors and source input, allows text-only query',()=>{
 const v=Array(384).fill(.1);const q=validateMorisQuery({query_embedding:v},config);
 expect(q.query_embedding).toEqual(v);expect(q.query_embedding).not.toBe(v);
 expect(validateMorisQuery({message:'part123'},config).query_embedding).toBeNull();
});

it('accepts bounded capture provenance as untrusted diagnostics, drops forged or invalid ROI',()=>{
 const camera={source_kind:'camera',frame_width_px:1280,frame_height_px:720,crop_roi:{x:20,y:10,width:1200,height:700},gate_status:'passed',temporal_stability:'verified_live'};
 expect(validateMorisQuery({message:'tìm linh kiện',capture_quality:camera},config).capture_quality).toEqual(camera);
 expect(normalizeCaptureQuality({...camera,crop_roi:{x:20,y:10,width:1300,height:700}})).toBeNull();
 expect(normalizeCaptureQuality({...camera,temporal_stability:'not_applicable_static'})).toBeNull();
 const upload={...camera,source_kind:'upload',crop_roi:null,temporal_stability:'not_applicable_static'};
 expect(normalizeCaptureQuality(upload)).toEqual(upload);
 expect(normalizeCaptureQuality({...upload,crop_roi:camera.crop_roi})).toBeNull();
 expect(normalizeCaptureQuality({...camera,optical_consistency:{status:'mismatch',capture_closed_count:4,optical_closed_count:2}}).optical_consistency)
   .toEqual({status:'mismatch',capture_closed_count:4,optical_closed_count:2});
 expect(normalizeCaptureQuality({...camera,optical_consistency:{status:'agree',capture_closed_count:-1,optical_closed_count:2}})).toBeNull();
});
