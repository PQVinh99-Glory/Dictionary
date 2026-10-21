import { processLayer1Optical } from '../src/moris/moris-layer1-optical.js';
import {describe,it,expect} from 'vitest';
import {normalizeGeometry} from '../functions/_lib/moris/v5/schemas/geometry.js';
import {normalizeGeometry as browserGeometry} from '../src/moris/retrieval/geometryEvidence.js';
import {computeHoleSimilarity,scoreCandidateGeometry} from '../functions/_lib/moris/v5/retrieval/geometricReranker.js';
import {analyzeStructuralEvidence} from '../functions/_lib/moris/v5/retrieval/structuralEvidence.js';
describe('M08 nullable geometry evidence',()=>{
 it('separates unknown from measured zero',()=>{
  expect(normalizeGeometry({}).hole_count).toBeNull();
  expect(normalizeGeometry({hole_count:0}).hole_count).toBe(0);
  expect(computeHoleSimilarity({},{})).toBeNull();
  expect(computeHoleSimilarity({hole_count:0},{hole_count:0})).toBe(1);
 });
 it('invalid mask removes geometric evidence without changing vector score',()=>{
  const q={hole_count:17,aspect_ratio:6,quality:{reliable:false}};
  const result=scoreCandidateGeometry({similarity:.9,hole_count:0,aspect_ratio:1},q);
  expect(result).toMatchObject({final_score:.9,s_holes:null,s_ratio:null,geometric_warning:null});
  expect(analyzeStructuralEvidence({query:{geometry:q},candidates:[{id:'a',hole_count:0}]}).byId.a.available).toBe(false);
 });
 it('absent candidate geometry is neutral, never receives artificial rewards',()=>{
  expect(scoreCandidateGeometry({similarity:.8},{hole_count:3,aspect_ratio:2})).toMatchObject({final_score:.8,s_holes:null,s_ratio:null});
 });
 it('explicit measured zero is not overwritten by legacy recovery',()=>{
  const c={similarity:.9,hole_count:0,geometry_version:'geometry_v1',identifying_features:'4 lỗ tròn'};
  expect(scoreCandidateGeometry(c,{hole_count:4}).s_holes).toBe(0);
 });
 it('checks counts, coordinate bounds and browser/server parity',()=>{
  for(let count=0;count<40;count++){
   const g={hole_count:count,big_hole_count:count,small_hole_count:1,aspect_ratio:NaN,hole_centroids:[{x:-1,y:0}]};
   expect(normalizeGeometry(g)).toEqual(browserGeometry(g));
   expect(normalizeGeometry(g)).toMatchObject({hole_count:null,hole_centroids:null,aspect_ratio:null,count_conflict:true});
  }
  for(const hole_count of [null,'0',-1,Infinity,NaN,129])expect(normalizeGeometry({hole_count}).hole_count).toBeNull();
 });
 it('counts synthetic masks with 0–3 holes consistently after 180 degrees',()=>{
  for(let holes=0;holes<=3;holes++){
   const w=120,h=80,rgba=new Uint8ClampedArray(w*h*4);
   for(let y=15;y<65;y++)for(let x=10;x<110;x++)rgba.set([70,70,70,255],(y*w+x)*4);
   for(let n=0;n<holes;n++)for(let y=33;y<43;y++)for(let x=25+n*25;x<35+n*25;x++)rgba[(y*w+x)*4+3]=0;
   const rotated=Uint8ClampedArray.from({length:rgba.length},(_,i)=>rgba[(w*h-1-Math.floor(i/4))*4+i%4]);
   const a=processLayer1Optical(rgba,w,h),b=processLayer1Optical(rotated,w,h);
   expect(a.holeCount).toBe(holes);expect(b.holeCount).toBe(holes);
  }
 });
 it('partial view/occlusion flags cannot create a hole conflict',()=>{
  const result=analyzeStructuralEvidence({query:{geometry:{hole_count:2}},candidates:[{id:'back',hole_count:0,quality:{reliable:false}}]});
  expect(result.conflicts).toBe(0);
 });
 it('preserves geometry for an alpha catalogue crop that touches the frame',()=>{
  const w=120,h=80,rgba=new Uint8ClampedArray(w*h*4);
  for(let y=15;y<65;y++)for(let x=0;x<110;x++)rgba.set([70,70,70,255],(y*w+x)*4);
  for(let y=33;y<43;y++)for(let x=50;x<60;x++)rgba[(y*w+x)*4+3]=0;
  const out=processLayer1Optical(rgba,w,h);
  const geometry=browserGeometry({quality:out.diagnostics.maskQuality,hole_count:out.holeCount,
   aspect_ratio:out.aspectRatio,hole_centroids:out.holeFeatures.map(h=>({x:h.x,y:h.y}))});
  expect(geometry.hole_count).toBe(1);
  expect(geometry.aspect_ratio).toBeGreaterThan(1);
  expect(geometry.hole_centroids).toHaveLength(1);
 });
});
