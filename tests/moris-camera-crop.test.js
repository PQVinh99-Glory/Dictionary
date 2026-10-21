import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadMethods(document) {
  let options;
  vm.runInNewContext(readFileSync('src/app.js','utf8'), {
    Vue:{ createApp(o) { options=o; return {mount(){}}; } },
    window:{addEventListener(){}}, document, atob, console,
    setTimeout:fn=>{ fn(); return 0; }, clearTimeout(){}
  });
  return options.methods;
}

describe('P03 final frame crop feeds the same query to encoder and search', () => {
  it('uses final-mask ROI, not display tracking box or full-frame JPEG', async () => {
    const sourceCtx={fillRect:vi.fn(),drawImage:vi.fn()};
    const cropCtx={drawImage:vi.fn()};
    const source={width:0,height:0,getContext:()=>sourceCtx,toDataURL:()=> 'data:full'};
    const crop={width:0,height:0,getContext:()=>cropCtx,toDataURL:()=> 'data:crop'};
    const document={createElement:vi.fn().mockReturnValueOnce(source).mockReturnValueOnce(crop)};
    const methods=loadMethods(document);
    const video={videoWidth:1280,videoHeight:720};
    const ctx={
      $refs:{camVideo:video},
      camera:{open:true,ready:true,busy:false,scanning:false,landscapeHint:false,lock:{ready:true,evidence:null,evidenceSummary:''}},
      moris:{captureEvidence:null,captureQuality:null},
      buildSubjectMaskDataUrl:vi.fn(async function(){
        this._camCaptureRoi={x:100,y:200,width:500,height:300};
        this.camera.lock.evidence={reliable:true};
        return 'data:mask';
      }),
      readCameraSize:vi.fn(async()=>null),
      stopCameraStream:vi.fn(),
      buildMorisQueryVector:vi.fn(async()=>({embedding:[.1]})),
      compareCaptureOpticalEvidence:vi.fn(()=>({status:'unknown',reason:'missing_evidence'})),
      closeCamera:vi.fn(),openMoris:vi.fn(),sendMorisMessage:vi.fn(async()=>{}),
      toast:vi.fn(),readError:e=>String(e?.message||e)
    };
    await methods.captureCamera.call(ctx);
    expect(cropCtx.drawImage).toHaveBeenCalledWith(source,100,200,500,300,0,0,500,300);
    expect(ctx.camera.previewUrl).toBe('data:full');
    expect(ctx.buildMorisQueryVector).toHaveBeenCalledWith('data:crop');
    expect(ctx.moris.imageDataUrl).toBe('data:crop');
    expect(ctx.moris.captureQuality.crop_roi).toEqual({x:100,y:200,width:500,height:300});
    expect(ctx.sendMorisMessage).toHaveBeenCalledOnce();
  });

  it('rejects partial uploaded image before embedding and restarts the camera', async () => {
    const methods=loadMethods({});
    const ctx={
      camera:{open:true,busy:false,scanning:false,scanStatus:''},
      moris:{captureEvidence:{reliable:true},captureQuality:null},
      stopCameraStream:vi.fn(),startCameraStream:vi.fn(async()=>{}),
      prepareMorisImage:vi.fn(async()=> 'data:partial'),
      validateMorisUploadDataUrl:vi.fn(async()=>{ throw new Error('Linh kiện chạm mép'); }),
      buildMorisQueryVector:vi.fn(),sendMorisMessage:vi.fn(),
      toast:vi.fn(),readError:e=>e.message
    };
    const event={target:{files:[{name:'partial.jpg'}],value:'x'}};
    await methods.onCameraFileSelect.call(ctx,event);
    expect(ctx.buildMorisQueryVector).not.toHaveBeenCalled();
    expect(ctx.sendMorisMessage).not.toHaveBeenCalled();
    expect(ctx.startCameraStream).toHaveBeenCalledOnce();
    expect(ctx.moris.captureEvidence).toBeNull();
    expect(ctx.toast).toHaveBeenCalledWith('error',expect.stringContaining('Linh kiện chạm mép'));
  });
});
