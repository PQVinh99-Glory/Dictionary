// Offline only: checks a manifest and optionally verifies private image bytes.
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {validateManifest} from '../evaluation/moris-v6/manifest.js';
import {validateCameraManifest} from '../evaluation/moris-v6/cameraManifest.js';
const [manifest,assetRoot]=process.argv.slice(2).filter(a=>!a.startsWith('--'));
if(!manifest)throw Error('Usage: node tools/validate-moris-dataset.mjs manifest.jsonl [asset-root] [--approved] [--camera-labels]');
const rows=(await readFile(manifest,'utf8')).trim().split('\n').map(JSON.parse);
const report=process.argv.includes('--camera-labels')
 ?validateCameraManifest(rows,{requireApproved:process.argv.includes('--approved')})
 :validateManifest(rows,{requireApproved:process.argv.includes('--approved')});
if(assetRoot){
 let verifiedMaskBytes=0;
 for(const row of rows){
  const file=resolve(assetRoot,row.asset_path),rel=relative(resolve(assetRoot),file);
  if(rel.startsWith('..')||isAbsolute(rel))throw Error('Asset outside allowed root');
  const sha=createHash('sha256').update(await readFile(file)).digest('hex');
  if(sha!==row.sha256)throw Error(`Hash mismatch: ${row.query_id}`);
  if(process.argv.includes('--camera-labels') && row.mask_annotation){
   const maskFile=resolve(assetRoot,row.mask_annotation.path);
   const maskRel=relative(resolve(assetRoot),maskFile);
   if(maskRel.startsWith('..')||isAbsolute(maskRel))throw Error('Mask outside allowed root');
   const maskSha=createHash('sha256').update(await readFile(maskFile)).digest('hex');
   if(maskSha!==row.mask_annotation.sha256)throw Error(`Mask hash mismatch: ${row.query_id}`);
   verifiedMaskBytes++;
  }
 }
 report.verified_image_bytes=rows.length;
 if(process.argv.includes('--camera-labels'))report.verified_mask_bytes=verifiedMaskBytes;
}
console.log(JSON.stringify(report,null,2));
