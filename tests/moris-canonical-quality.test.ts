import { describe,it,expect } from 'vitest';
import { processLayer1Optical,segmentForegroundAndHoles } from '../src/moris/moris-layer1-optical.js';
function fixture(mode='white',vertical=false,edge=false,long=false) {
 const w=120,h=120,rgba=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;const bg=mode==='black'?0:mode==='gray'?180:240;
  rgba.set([bg,bg,bg,mode==='alpha'?0:255],i);
  const u=vertical?y:x,v=vertical?x:y;
  if(u>=(edge?0:15)&&u<105&&v>=50&&v<(long?55:70))rgba.set([60,60,60,255],i);
  if(mode==='colored'&&(x<5||x>114||y<5||y>114))rgba.set(x%2?[255,0,0,255]:[0,255,0,255],i);
 }
 return {rgba,w,h};
}
describe('M07 deterministic canonicalization and mask quality',()=>{
 it.each(['alpha','black','white','gray'])('supports %s and replays index/query identically',mode=>{
  const {rgba,w,h}=fixture(mode);const a=processLayer1Optical(rgba,w,h),b=processLayer1Optical(rgba,w,h);
  expect(a.diagnostics.maskQuality.reliable).toBe(true);
  expect(a.fgMask).toEqual(b.fgMask);expect(a.pseudoRgbTensor).toEqual(b.pseudoRgbTensor);
  expect(a.canonicalRgba.length).toBe(224*224*4);
 });
 it('does not invent full-frame foreground on blank/exposed photos',()=>{
  const rgba=new Uint8ClampedArray(64*64*4).fill(255);
  const seg=segmentForegroundAndHoles(rgba,64,64);
  expect(seg.foregroundArea).toBe(0);expect(seg.diagnostics.maskQuality.reliable).toBe(false);
  expect(()=>processLayer1Optical(rgba,64,64)).toThrow(/vật thể/);
 });
 it('counts a large enclosed alpha slot but not an open edge notch',()=>{
  const w=200,h=120,rgba=new Uint8ClampedArray(w*h*4);
  for(let y=20;y<100;y++)for(let x=10;x<190;x++)rgba.set([45,45,45,255],(y*w+x)*4);
  // The enclosed slot occupies more than 45% of the remaining metal area.
  for(let y=32;y<88;y++)for(let x=65;x<175;x++)rgba.set([0,0,0,0],(y*w+x)*4);
  for(let y=52;y<68;y++)for(let x=30;x<46;x++)rgba.set([0,0,0,0],(y*w+x)*4);
  // This notch is connected to the exterior and must stay outside hole_count.
  for(let y=20;y<42;y++)for(let x=50;x<59;x++)rgba.set([0,0,0,0],(y*w+x)*4);
  const seg=segmentForegroundAndHoles(rgba,w,h);
  const out=processLayer1Optical(rgba,w,h);
  expect(seg.holes.length).toBe(2);
  expect(out.holeCount).toBe(2);
  expect(out.holeFeatures).toHaveLength(2);
 });
 it('keeps measured per-view geometry from a tightly cropped alpha catalogue asset',()=>{
  const {rgba,w,h}=fixture('alpha',false,true);
  for(let y=56;y<64;y++)for(let x=50;x<58;x++)rgba.set([0,0,0,0],(y*w+x)*4);
  const out=processLayer1Optical(rgba,w,h);
  expect(out.diagnostics.maskQuality.flags).toContain('subject_touches_edge');
  expect(out.diagnostics.maskQuality.reliable).toBe(true);
  expect(out.holeCount).toBe(1);
  expect(out.aspectRatio).toBeGreaterThan(1);
  expect(out.holeFeatures).toHaveLength(1);
 });
 it('still rejects an edge-clipped opaque camera image',()=>{
  const {rgba,w,h}=fixture('white',false,true);
  const out=processLayer1Optical(rgba,w,h);
  expect(out.diagnostics.maskQuality.flags).toContain('subject_touches_edge');
  expect(out.diagnostics.maskQuality.reliable).toBe(false);
 });
 it('flags clipped edges and nonuniform backgrounds',()=>{
  for(const [mode,edge,flag] of [['white',true,'subject_touches_edge'],['colored',false,'background_nonuniform']] as const){
   const {rgba,w,h}=fixture(mode,false,edge);
   expect(processLayer1Optical(rgba,w,h).diagnostics.maskQuality.flags).toContain(flag);
  }
 });
 it('reports border shadow uncertainty and clipped foreground highlights',()=>{
  const shadow=fixture('white');
  for(let y=0;y<120;y++)for(let x=0;x<12;x++)shadow.rgba.set([120,120,120,255],(y*120+x)*4);
  expect(processLayer1Optical(shadow.rgba,120,120).diagnostics.maskQuality.reliable).toBe(false);
  const glare=fixture('alpha');
  for(let i=0;i<glare.rgba.length;i+=4)if(glare.rgba[i+3])glare.rgba.set([255,255,255,255],i);
  expect(processLayer1Optical(glare.rgba,120,120).diagnostics.maskQuality.flags).toContain('foreground_highlights_clipped');
 });
 it('preserves thin-part aspect under 0/90/180-degree input poses',()=>{
  const ratios=[];
  for(const vertical of [false,true]){
   const {rgba,w,h}=fixture('alpha',vertical,false,true);
   for(const flip of [false,true]){
    const data=flip?Uint8ClampedArray.from({length:rgba.length},(_,i)=>rgba[(w*h-1-Math.floor(i/4))*4+i%4]):rgba;
    const out=processLayer1Optical(data,w,h);let minX=224,maxX=0,minY=224,maxY=0;
    out.fgMask.forEach((v,i)=>{if(v){minX=Math.min(minX,i%224);maxX=Math.max(maxX,i%224);minY=Math.min(minY,Math.floor(i/224));maxY=Math.max(maxY,Math.floor(i/224));}});
    ratios.push((maxX-minX+1)/(maxY-minY+1));
   }
  }
  expect(Math.min(...ratios)).toBeGreaterThan(12);
  expect(Math.max(...ratios)-Math.min(...ratios)).toBeLessThan(3);
 });
 it('rejects malformed dimensions before allocating large masks',()=>{
  expect(()=>processLayer1Optical(new Uint8ClampedArray(4),1e9,1e9)).toThrow(/dimensions/);
 });
});
