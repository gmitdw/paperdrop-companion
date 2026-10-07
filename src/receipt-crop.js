import {receiptPdf} from './receipt-pdf.js';
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
export async function cropReceipt(file,store,collection){
  const dialog=$('crop-dialog'),screen=$('crop-canvas'),ctx=screen.getContext('2d'),frame=$('crop-frame');
  const handles=[...dialog.querySelectorAll('.crop-handle')];
  let draft=await store.get('receipt-draft'),source,preview,corners=fullQuad(),editing=false,rotation=0,working=true,finish,index=0,editStart;
  if(file&&draft)throw new Error('Resume your unfinished receipt before starting another.');
  if(file){draft={collection,sections:[{original:file}],index:0};await store.set('receipt-draft',draft);draft=await store.get('receipt-draft');}
  if(!draft)return null;
  index=draft.index||0;
  const done=new Promise(resolve=>finish=resolve),note=text=>$('crop-note').textContent=text;
  function controls(){
    dialog.classList.toggle('editing',editing);
    $('crop-title').textContent=editing?'Adjust edges':'Check your receipt';
    for(const id of ['crop-save','crop-add','crop-more','crop-done'])$(id).disabled=working;
    $('crop-previous').disabled=working||index===0;
    $('crop-next').disabled=working||index===draft.sections.length-1;
    $('crop-pages').hidden=editing||draft.sections.length<2;
    $('crop-page').textContent=`${index+1} of ${draft.sections.length}`;
    $('crop-remove-section').hidden=draft.sections.length<2;
    handles.forEach(h=>h.hidden=!editing);
  }
  function draw(){
    const img=editing?source:preview;if(!img)return;
    const stage=$('crop-stage'),scale=Math.min((stage.clientWidth-56)/img.width,(stage.clientHeight-56)/img.height,1);
    const w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
    // Explicit dimensions keep the hit area and pointer capture stable during dragging.
    frame.style.width=w+'px';frame.style.height=h+'px';
    if(screen.width!==w||screen.height!==h){screen.width=w;screen.height=h;}
    ctx.clearRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
    if(editing){
      ctx.fillStyle='#0009';ctx.beginPath();ctx.rect(0,0,w,h);
      ctx.moveTo(corners[0].x*w,corners[0].y*h);for(const p of corners.slice(1))ctx.lineTo(p.x*w,p.y*h);ctx.closePath();ctx.fill('evenodd');
      ctx.beginPath();ctx.moveTo(corners[0].x*w,corners[0].y*h);for(const p of corners.slice(1))ctx.lineTo(p.x*w,p.y*h);ctx.closePath();ctx.strokeStyle='#7dd3b0';ctx.lineWidth=2;ctx.stroke();
      handles.forEach((h,i)=>{h.style.left=corners[i].x*100+'%';h.style.top=corners[i].y*100+'%';});
    }
  }
  function rotated(img){if(!rotation)return img;const c=canvas(rotation%2?img.height:img.width,rotation%2?img.width:img.height),x=c.getContext('2d');x.translate(c.width/2,c.height/2);x.rotate(rotation*Math.PI/2);x.drawImage(img,-img.width/2,-img.height/2);return c;}
  async function persist(){draft.index=index;await store.set('receipt-draft',draft);draft=await store.get('receipt-draft');}
  async function makePreview(){
    working=true;controls();note('Straightening your receipt…');await pause();
    try{
      preview=rotated(straighten(source,corners));
      const blob=await new Promise(resolve=>preview.toBlob(resolve,'image/jpeg',.94));
      if(!blob)throw new Error('Could not prepare this photo.');
      Object.assign(draft.sections[index],{blob,width:preview.width,height:preview.height,corners,rotation});
      await persist();editing=false;
      note(draft.sections.length>1?'Sections saved here. Include a little overlap when adding another.':'Check that the whole receipt is visible.');
    }catch(e){note('Your photo is kept here. '+e.message);throw e;}
    finally{working=false;controls();draw();}
  }
  async function load(){
    working=true;editing=false;controls();note('Finding receipt edges…');
    try{
      const s=draft.sections[index];source=null;preview=null;source=await decode(s.original);rotation=s.rotation||0;
      if(s.corners)corners=s.corners;
      else{const scale=Math.min(1,440/Math.max(source.width,source.height)),small=canvas(Math.max(1,Math.round(source.width*scale)),Math.max(1,Math.round(source.height*scale)));small.getContext('2d').drawImage(source,0,0,small.width,small.height);await pause();corners=detectReceipt(small.getContext('2d').getImageData(0,0,small.width,small.height)).corners;}
      await makePreview();
    }catch(e){working=false;controls();$('crop-save').disabled=true;$('crop-add').disabled=true;note('This photo could not be prepared. Close to keep the draft, or use ••• to discard it. '+e.message);}
  }
  function close(value){observer.disconnect();dialog.close();finish(value);}
  dialog.oncancel=event=>{event.preventDefault();if(!working){if(editing)cancelEdit();else close(null);}};
  $('crop-cancel').onclick=()=>{if(!working)close(null);};
  $('crop-more').onclick=()=>{$('crop-tools').hidden=!$('crop-tools').hidden;$('crop-more').setAttribute('aria-expanded',String(!$('crop-tools').hidden));};
  const hideTools=()=>{$('crop-tools').hidden=true;$('crop-more').setAttribute('aria-expanded','false');};
  $('crop-adjust').onclick=()=>{if(working||!source)return;hideTools();editStart=corners.map(p=>({...p}));editing=true;controls();draw();note('Drag any corner to the receipt edge.');};
  function cancelEdit(){corners=editStart;editing=false;controls();draw();note('Check that the whole receipt is visible.');}
  $('crop-edit-cancel').onclick=()=>{if(!working)cancelEdit();};
  $('crop-done').onclick=()=>{if(!working)makePreview().catch(()=>{});};
  $('crop-whole').onclick=()=>{if(working||!source)return;hideTools();corners=fullQuad();makePreview().catch(()=>{});};
  $('crop-rotate').onclick=()=>{if(working||!source)return;hideTools();rotation=(rotation+1)%4;makePreview().catch(()=>{});};
  $('crop-discard').onclick=async()=>{if(working||!confirm('Discard this unfinished receipt and all its sections?'))return;working=true;controls();try{await store.set('receipt-draft',null);close(null);}catch(e){working=false;controls();note(e.message);}};
  $('crop-remove-section').onclick=async()=>{
    if(working||draft.sections.length<2||!confirm('Remove this section? The other sections will stay.'))return;
    hideTools();working=true;controls();const previous=draft.sections.slice(),previousIndex=index;
    draft.sections.splice(index,1);index=Math.min(index,draft.sections.length-1);
    try{await persist();await load();}catch(e){draft.sections=previous;index=previousIndex;await load();note('Could not remove this section. '+e.message);}
  };
  handles.forEach((handle,i)=>{
    let pointer=null;
    handle.onpointerdown=e=>{if(working||!editing)return;pointer=e.pointerId;handle.setPointerCapture(pointer);e.preventDefault();};
    handle.onpointermove=e=>{
      if(pointer!==e.pointerId)return;e.preventDefault();const r=frame.getBoundingClientRect(),next=corners.map(p=>({...p}));
      next[i]={x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};
      if(validQuad(next)){corners=next;draw();}
    };
    handle.onpointerup=handle.onpointercancel=handle.onlostpointercapture=()=>{pointer=null;};
    handle.onkeydown=e=>{const delta={ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,-.01],ArrowDown:[0,.01]}[e.key];if(!delta||working)return;e.preventDefault();const next=corners.map(p=>({...p}));next[i]={x:Math.max(0,Math.min(1,next[i].x+delta[0])),y:Math.max(0,Math.min(1,next[i].y+delta[1]))};if(validQuad(next)){corners=next;draw();}};
  });
  $('crop-add').onclick=()=>{if(working)return;if(draft.sections.length>=20){note('This receipt has 20 sections. Save it before starting another.');return;}hideTools();$('section-camera').click();};
  $('section-camera').onchange=async e=>{
    const next=e.target.files[0];e.target.value='';if(!next||working)return;
    working=true;controls();draft.sections.push({original:next});index=draft.sections.length-1;
    try{await persist();await load();}catch(error){draft.sections.pop();index=draft.sections.length-1;await load();note('The new section could not be saved. '+error.message);}
  };
  $('crop-previous').onclick=()=>{if(!working&&index>0){index--;load();}};
  $('crop-next').onclick=()=>{if(!working&&index<draft.sections.length-1){index++;load();}};
  $('crop-save').onclick=async()=>{
    if(working)return;working=true;controls();note('Saving your receipt…');
    try{
      if(draft.sections.some(s=>!s.blob))throw new Error('Check each section before saving.');
      const result=await receiptPdf(draft.sections);
      // Commit the receipt and remove its draft together; retries cannot create a duplicate.
      await store.save(result,draft.collection,draft.sections.map(s=>s.original),true);close(result);
    }catch(e){working=false;controls();note('Your sections are still saved here. '+e.message);}
  };
  hideTools();controls();dialog.showModal();$('crop-title').focus({preventScroll:true});
  const observer=new ResizeObserver(draw);observer.observe($('crop-stage'));
  await load();const result=await done;screen.width=screen.height=1;if(source)source.width=source.height=1;preview=null;return result;
}
