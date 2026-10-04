import {detectReceipt,fullQuad,validQuad,projection} from './receipt-geometry.js';
const $=id=>document.getElementById(id);
const pause=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
async function decode(file){
  if(file.size>50*1024*1024)throw new Error('Please choose a photo smaller than 50 MB.');
  const url=URL.createObjectURL(file),img=new Image();
  try{img.src=url;await img.decode();const scale=Math.min(1,2600/Math.max(img.naturalWidth,img.naturalHeight));
    const c=canvas(Math.max(1,Math.round(img.naturalWidth*scale)),Math.max(1,Math.round(img.naturalHeight*scale)));
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c;
  }finally{URL.revokeObjectURL(url);}
}
export function straighten(source,q){
  if(!validQuad(q))throw new Error('Keep the four corners in order around the receipt.');
  const points=q.map(p=>({x:p.x*(source.width-1),y:p.y*(source.height-1)}));
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const w=Math.max(2,Math.round(Math.max(distance(points[0],points[1]),distance(points[3],points[2]))));
  const h=Math.max(2,Math.round(Math.max(distance(points[0],points[3]),distance(points[1],points[2]))));
  const result=canvas(w,h),ctx=result.getContext('2d'),out=ctx.createImageData(w,h);
  const pixels=source.getContext('2d').getImageData(0,0,source.width,source.height).data;
  const map=projection(points);
  for(let y=0;y<h;y++){
    const v=y/(h-1);
    for(let x=0;x<w;x++){
      const p=map(x/(w-1),v),px=Math.max(0,Math.min(source.width-1,p.x)),py=Math.max(0,Math.min(source.height-1,p.y));
      const ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy;
      const a=4*(iy*source.width+ix),b=4*(iy*source.width+Math.min(ix+1,source.width-1));
      const c=4*(Math.min(iy+1,source.height-1)*source.width+ix),d=4*(Math.min(iy+1,source.height-1)*source.width+Math.min(ix+1,source.width-1));
      const dest=4*(y*w+x);
      for(let k=0;k<3;k++)out.data[dest+k]=(pixels[a+k]*(1-fx)+pixels[b+k]*fx)*(1-fy)+(pixels[c+k]*(1-fx)+pixels[d+k]*fx)*fy;
      out.data[dest+3]=255;
    }
  }
  ctx.putImageData(out,0,0);return result;
}
export async function cropReceipt(file){
  const dialog=$('crop-dialog'),screen=$('crop-canvas'),ctx=screen.getContext('2d');
  let source,preview,corners=fullQuad(),editing=false,drag=-1,rotation=0,working=true,finish;
  const done=new Promise(resolve=>finish=resolve);
  const note=text=>$('crop-note').textContent=text;
  function draw(){
    const img=editing?source:preview;if(!img)return;
    const scale=Math.min(1,720/Math.max(img.width,img.height));screen.width=Math.round(img.width*scale);screen.height=Math.round(img.height*scale);
    ctx.drawImage(img,0,0,screen.width,screen.height);
    if(editing){
      ctx.fillStyle='#0008';ctx.beginPath();ctx.rect(0,0,screen.width,screen.height);
      const pts=corners.map(p=>({x:p.x*screen.width,y:p.y*screen.height}));
      ctx.moveTo(pts[0].x,pts[0].y);for(const p of pts.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.fill('evenodd');
      ctx.strokeStyle='#7dd3b0';ctx.lineWidth=3;ctx.stroke();
      const radius=12*screen.width/Math.max(1,screen.getBoundingClientRect().width);
      for(const p of pts){ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fillStyle='#7dd3b0';ctx.fill();ctx.strokeStyle='#10251d';ctx.stroke();}
    }
  }
  function rotated(img){if(!rotation)return img;const c=canvas(rotation%2?img.height:img.width,rotation%2?img.width:img.height),x=c.getContext('2d');x.translate(c.width/2,c.height/2);x.rotate(rotation*Math.PI/2);x.drawImage(img,-img.width/2,-img.height/2);return c;}
  async function makePreview(){
    working=true;$('crop-save').disabled=true;note('Straightening your receipt…');await pause();
    try{preview=rotated(straighten(source,corners));editing=false;draw();$('crop-save').textContent='Save receipt';$('crop-adjust').textContent='Adjust edges';note('Check that the whole receipt is visible, then save.');}
    catch(e){note(e.message);}
    finally{working=false;$('crop-save').disabled=false;}
  }
  function close(value){dialog.close();finish(value);}
  dialog.oncancel=event=>{event.preventDefault();if(!working)close(null);};
  $('crop-cancel').onclick=()=>{if(!working)close(null);};
  $('crop-adjust').onclick=async()=>{if(working)return;if(editing){await makePreview();return;}editing=true;draw();$('crop-save').textContent='Preview crop';$('crop-adjust').textContent='Preview crop';note('Drag each corner to the edge of the receipt.');};
  $('crop-whole').onclick=async()=>{if(working)return;corners=fullQuad();await makePreview();};
  $('crop-rotate').onclick=async()=>{if(working)return;rotation=(rotation+1)%4;await makePreview();};
  screen.onpointerdown=event=>{
    if(!editing||working)return;const r=screen.getBoundingClientRect(),x=(event.clientX-r.left)/r.width,y=(event.clientY-r.top)/r.height;
    const distances=corners.map(p=>Math.hypot((p.x-x)*r.width,(p.y-y)*r.height));drag=distances.indexOf(Math.min(...distances));
    if(distances[drag]>60){drag=-1;return;}screen.setPointerCapture(event.pointerId);event.preventDefault();
  };
  screen.onpointermove=event=>{if(drag<0)return;const r=screen.getBoundingClientRect(),next=corners.map(p=>({...p}));next[drag]={x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))};if(validQuad(next)){corners=next;draw();}};
  screen.onpointerup=screen.onpointercancel=()=>drag=-1;
  $('crop-save').onclick=async()=>{
    if(working)return;if(editing){await makePreview();return;}
    working=true;$('crop-save').disabled=true;note('Preparing your receipt…');
    try{const blob=await new Promise(resolve=>preview.toBlob(resolve,'image/jpeg',.94));if(!blob)throw new Error('Could not prepare this photo. Please try again.');
      close(new File([blob],(file.name||'Receipt').replace(/\.[^.]+$/,'')+'-cropped.jpg',{type:'image/jpeg'}));
    }catch(e){note(e.message);working=false;$('crop-save').disabled=false;}
  };
  note('Finding receipt edges…');$('crop-save').disabled=true;dialog.showModal();$('crop-title').focus({preventScroll:true});
  try{
    source=await decode(file);const scale=Math.min(1,440/Math.max(source.width,source.height));
    const small=canvas(Math.round(source.width*scale),Math.round(source.height*scale));small.getContext('2d').drawImage(source,0,0,small.width,small.height);
    await pause();const found=detectReceipt(small.getContext('2d').getImageData(0,0,small.width,small.height));corners=found.corners;
    await makePreview();if(!found.confident)note('Edges were unclear, so the whole photo is kept. Tap Adjust edges to crop it.');
  }catch(e){dialog.close();throw new Error('This photo could not be opened. '+e.message);}
  const result=await done;screen.width=screen.height=1;source.width=source.height=1;preview=null;return result;
}
