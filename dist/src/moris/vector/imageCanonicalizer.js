const DEFAULT_SIZE = 448;

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }

async function imageSourceToBlob(source){
  if(source instanceof Blob) return source;
  const s = String(source || '');
  if(!s) throw new Error('Thiếu nguồn ảnh.');
  const res = await fetch(s);
  if(!res.ok) throw new Error(`Không tải được ảnh HTTP ${res.status}`);
  return res.blob();
}

async function decodeBitmap(source){
  const blob = await imageSourceToBlob(source);
  return createImageBitmap(blob,{imageOrientation:'from-image'});
}

function borderStats(data,w,h){
  const samples=[];
  const step=Math.max(1,Math.floor(Math.min(w,h)/40));
  for(let x=0;x<w;x+=step){
    samples.push((0*w+x)*4,((h-1)*w+x)*4);
  }
  for(let y=0;y<h;y+=step){
    samples.push((y*w+0)*4,(y*w+(w-1))*4);
  }
  let r=0,g=0,b=0,n=0;
  for(const i of samples){
    if(data[i+3] < 20) continue;
    r+=data[i]; g+=data[i+1]; b+=data[i+2]; n++;
  }
  if(!n) return {r:245,g:245,b:245,spread:0};
  r/=n; g/=n; b/=n;
  let spread=0;
  for(const i of samples){
    if(data[i+3] < 20) continue;
    const d=Math.hypot(data[i]-r,data[i+1]-g,data[i+2]-b);
    spread+=d;
  }
  spread/=Math.max(1,n);
  return {r,g,b,spread};
}

function detectMask(imageData,w,h){
  const d=imageData.data;
  const bg=borderStats(d,w,h);
  const mask=new Uint8Array(w*h);
  let alphaFg=0, opaque=0;
  for(let p=0;p<w*h;p++){
    const i=p*4;
    if(d[i+3] < 245) alphaFg++;
    if(d[i+3] > 20) opaque++;
  }
  const alphaAware = alphaFg > w*h*0.01;
  const threshold = clamp(24 + bg.spread*1.4, 28, 82);
  let count=0;
  for(let p=0;p<w*h;p++){
    const i=p*4;
    const a=d[i+3];
    let fg=false;
    if(alphaAware){
      fg=a>36;
    }else{
      const dist=Math.hypot(d[i]-bg.r,d[i+1]-bg.g,d[i+2]-bg.b);
      fg=dist>threshold;
    }
    if(fg){ mask[p]=255; count++; }
  }
  const coverage=count/Math.max(1,w*h);
  const confidence = alphaAware
    ? clamp(0.85 + Math.min(0.14,coverage),0,1)
    : clamp(1 - bg.spread/80,0,1) * (coverage>0.03 && coverage<0.92 ? 1 : 0.35);
  return {mask,coverage,confidence,alphaAware,bg,threshold};
}

function bboxFromMask(mask,w,h){
  let minX=w,minY=h,maxX=-1,maxY=-1,count=0;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      if(mask[y*w+x] < 128) continue;
      count++; minX=Math.min(minX,x); minY=Math.min(minY,y);
      maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
    }
  }
  if(!count) return null;
  return {minX,minY,maxX,maxY,count};
}

function canvasToDataUrl(canvas,type='image/webp',quality=.9){
  return canvas.toDataURL(type,quality);
}

function makeGrayVariant(rgbCanvas){
  const c=document.createElement('canvas');
  c.width=rgbCanvas.width; c.height=rgbCanvas.height;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(rgbCanvas,0,0);
  const img=ctx.getImageData(0,0,c.width,c.height);
  const d=img.data;
  for(let i=0;i<d.length;i+=4){
    const y=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];
    // mild contrast normalization around mid-gray
    const v=clamp((y-128)*1.12+128,0,255);
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(img,0,0);
  return c;
}

export async function canonicalizeImageVariants(source,{
  size=DEFAULT_SIZE,
  padding=.14,
  includeGray=true
}={}){
  const bitmap=await decodeBitmap(source);
  const maxDim=640;
  const scale=Math.min(1,maxDim/Math.max(bitmap.width,bitmap.height));
  const sw=Math.max(1,Math.round(bitmap.width*scale));
  const sh=Math.max(1,Math.round(bitmap.height*scale));

  const src=document.createElement('canvas');
  src.width=sw; src.height=sh;
  const sctx=src.getContext('2d',{willReadFrequently:true});
  sctx.drawImage(bitmap,0,0,sw,sh);
  bitmap.close?.();

  const img=sctx.getImageData(0,0,sw,sh);
  const det=detectMask(img,sw,sh);
  let box=bboxFromMask(det.mask,sw,sh);

  if(!box || det.coverage<.02 || det.coverage>.96){
    box={minX:0,minY:0,maxX:sw-1,maxY:sh-1,count:sw*sh};
  }

  const bw=box.maxX-box.minX+1;
  const bh=box.maxY-box.minY+1;
  const pad=Math.round(Math.max(bw,bh)*padding);
  let x0=clamp(box.minX-pad,0,sw-1);
  let y0=clamp(box.minY-pad,0,sh-1);
  let x1=clamp(box.maxX+pad,0,sw-1);
  let y1=clamp(box.maxY+pad,0,sh-1);
  const cw=x1-x0+1, ch=y1-y0+1;

  // square crop centered on detected subject
  const side=Math.max(cw,ch);
  const cx=(x0+x1)/2, cy=(y0+y1)/2;
  x0=clamp(Math.round(cx-side/2),0,Math.max(0,sw-side));
  y0=clamp(Math.round(cy-side/2),0,Math.max(0,sh-side));
  const cropSide=Math.min(side,sw-x0,sh-y0);

  const rgb=document.createElement('canvas');
  rgb.width=size; rgb.height=size;
  const rctx=rgb.getContext('2d',{alpha:false});
  rctx.fillStyle='#f3f4f6';
  rctx.fillRect(0,0,size,size);
  rctx.imageSmoothingEnabled=true;
  rctx.imageSmoothingQuality='high';
  rctx.drawImage(src,x0,y0,cropSide,cropSide,0,0,size,size);

  const variants=[{
    probe_id:'canon_rgb_v2',
    view_variant:'canon_rgb_v2',
    image_data_url:canvasToDataUrl(rgb),
    diagnostics:{
      subject_coverage:Number(det.coverage.toFixed(4)),
      mask_confidence:Number(det.confidence.toFixed(4)),
      alpha_aware:det.alphaAware,
      background_spread:Number(det.bg.spread.toFixed(2))
    }
  }];

  if(includeGray){
    const gray=makeGrayVariant(rgb);
    variants.push({
      probe_id:'canon_gray_v2',
      view_variant:'canon_gray_v2',
      image_data_url:canvasToDataUrl(gray),
      diagnostics:variants[0].diagnostics
    });
  }

  return {
    variants,
    diagnostics:variants[0].diagnostics,
    preprocess_version:'kim_canon_v2'
  };
}
