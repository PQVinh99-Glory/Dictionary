import { describe, it, expect } from 'vitest';
import { validateCameraManifest } from '../evaluation/moris-v6/cameraManifest.js';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function row() {
  return {
    query_id:'fixture-camera-1', expected_sku:'FIXTURE', known:true,
    asset_path:'camera/fixture.webp', sha256:'a'.repeat(64),
    source_kind:'camera', source_group:'fixture-session', physical_shot_id:'fixture-shot',
    split:'development', label_status:'approved', curator:'fixture', labelled_at:'2026-10-21T00:00:00Z',
    view:'front', lighting:'white_table', angle:'top',
    camera_capture:{
      device_model:'fixture-phone',os_name:'fixture-os',os_version:'1',
      browser_name:'fixture-browser',browser_version:'1',orientation:'landscape',
      frame_width_px:1920,frame_height_px:1080,glare:'mild',occluded:false,
      full_subject_label_status:'approved',full_subject:true,
      full_subject_curator:'fixture',full_subject_labelled_at:'2026-10-21T00:00:00Z'
    },
    perception_labels:{
      status:'approved',count_certainty:'exact',sawtooth:'absent',curator:'fixture',labelled_at:'2026-10-21T00:00:00Z',
      instances:[
        {instance_id:'hole-1',boundary:'closed',format_tag:'tron'},
        {instance_id:'notch-1',boundary:'open',format_tag:'gai_moc'}
      ]
    },
    mask_annotation:{path:'masks/fixture.png',sha256:'b'.repeat(64)}
  };
}

describe('P00 camera manifest labels',()=>{
  it('separates SKU approval, full-subject GT, closed/open instances and mask coverage',()=>{
    const report=validateCameraManifest([row()],{requireApproved:true});
    expect(report).toMatchObject({camera:1,approved:1,full_subject_approved:1,perception_approved:1,masks_available:1});
  });

  it('keeps missing annotation unknown rather than treating it as zero holes or full subject',()=>{
    const pending=row();
    pending.camera_capture.full_subject_label_status='pending';
    pending.camera_capture.full_subject=null;
    pending.perception_labels={status:'pending'};
    delete pending.mask_annotation;
    const report=validateCameraManifest([pending]);
    expect(report).toMatchObject({camera:1,full_subject_approved:0,perception_approved:0,masks_available:0});
    pending.perception_labels.instances=[];
    expect(()=>validateCameraManifest([pending])).toThrow('Pending perception instances');
  });

  it('rejects repeated instance IDs and unknown taxonomy, preventing double count',()=>{
    const duplicated=row();
    duplicated.perception_labels.instances[1].instance_id='hole-1';
    expect(()=>validateCameraManifest([duplicated])).toThrow('Invalid perception instance');
    const invalid=row();
    invalid.perception_labels.instances[0].format_tag='not_a_format';
    expect(()=>validateCameraManifest([invalid])).toThrow('Invalid perception instance');
    const sawtoothAsCount=row();
    sawtoothAsCount.perception_labels.instances[0].format_tag='rang_cua';
    expect(()=>validateCameraManifest([sawtoothAsCount])).toThrow('Invalid perception instance');
  });

  it('rejects unlabeled full subject and path traversal in GT mask',()=>{
    const missing=row();
    missing.camera_capture.full_subject=null;
    expect(()=>validateCameraManifest([missing])).toThrow('Missing full-subject label');
    const badMask=row();
    badMask.mask_annotation.path='../secret.png';
    expect(()=>validateCameraManifest([badMask])).toThrow('Invalid mask annotation');
  });

  it('CLI verifies source and mask bytes when --camera-labels is requested',()=>{
    const root=mkdtempSync(join(tmpdir(),'moris-camera-manifest-'));
    try {
      mkdirSync(join(root,'camera'));
      mkdirSync(join(root,'masks'));
      const source=Buffer.from('fixture camera bytes');
      const mask=Buffer.from('fixture mask bytes');
      writeFileSync(join(root,'camera/fixture.webp'),source);
      writeFileSync(join(root,'masks/fixture.png'),mask);
      const manifest=row();
      manifest.sha256=createHash('sha256').update(source).digest('hex');
      manifest.mask_annotation.sha256=createHash('sha256').update(mask).digest('hex');
      const path=join(root,'manifest.jsonl');
      writeFileSync(path,JSON.stringify(manifest)+'\n');
      const cli='tools/validate-moris-dataset.mjs';
      const result=JSON.parse(execFileSync(process.execPath,[cli,path,root,'--camera-labels','--approved'],{encoding:'utf8'}));
      expect(result).toMatchObject({verified_image_bytes:1,verified_mask_bytes:1});
      writeFileSync(join(root,'masks/fixture.png'),'tampered');
      expect(()=>execFileSync(process.execPath,[cli,path,root,'--camera-labels'],{encoding:'utf8',stdio:'pipe'}))
        .toThrow('Mask hash mismatch');
    } finally {
      rmSync(root,{recursive:true,force:true});
    }
  });
});
