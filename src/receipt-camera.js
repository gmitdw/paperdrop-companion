// Continuous capture. Every section is committed as durable bytes before the
// shutter is enabled again; the camera is never kept running in the background.
export async function captureReceiptCamera(store,collection,media=navigator.mediaDevices){
 const existing=await store.get('receipt-draft');
 let draft=existing||{collection,sections:[],index:0},stream=null,closed=false,busy=false,result;
 const d=document.createElement('dialog');d.className='camera-dialog';
 d.innerHTML=`<div class="camera-heading"><button class="camera-close" aria-label="Close and keep photos">×</button><h2 tabindex="-1">Take a Photo</h2><button class="camera-review">Review</button></div><p class="camera-note" role="status">Opening camera…</p><div class="camera-stage"><div class="camera-frame"><video autoplay muted playsinline></video><canvas class="camera-guide" aria-label="Previous photo alignment guide" hidden></canvas><span class="camera-outline" aria-hidden="true"></span></div></div><div class="camera-count"></div><div class="camera-footer"><button class="camera-shutter">Take a Photo</button><button class="camera-save primary">Save receipt</button></div><button class="camera-resume" hidden>Resume camera</button><button class="camera-fallback" hidden>Use phone camera</button><input class="native-camera" type="file" accept="image/*" capture="environment" hidden>`;
 const video=d.querySelector('video'),frame=d.querySelector('.camera-frame'),stage=d.querySelector('.camera-stage'),guide=d.querySelector('.camera-guide'),note=d.querySelector('.camera-note'),shutter=d.querySelector('.camera-shutter'),save=d.querySelector('.camera-save'),review=d.querySelector('.camera-review'),resume=d.querySelector('.camera-resume');
 const done=new Promise(resolve=>result=resolve);
 function controls(){shutter.disabled=busy||!stream||draft.sections.length>=20;save.disabled=review.disabled=busy||!draft.sections.length;d.querySelector('.camera-count').textContent=draft.sections.length?`${draft.sections.length} section${draft.sections.length===1?'':'s'} saved on this device`:'';}
 function stop(){stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;controls();}
 function size(){if(!video.videoWidth)return;const ratio=video.videoWidth/video.videoHeight,w=Math.min(stage.clientWidth,stage.clientHeight*ratio);frame.style.width=w+'px';frame.style.height=w/ratio+'px';}
 async function showGuide(){
  guide.hidden=true;if(!draft.sections.length)return;
  const previous=draft.sections.at(-1).original,url=URL.createObjectURL(previous),img=new Image();
  try{img.src=url;await img.decode();guide.width=img.naturalWidth;guide.height=Math.round(img.naturalHeight*.25);guide.getContext('2d').drawImage(img,0,img.naturalHeight-guide.height,img.naturalWidth,guide.height,0,0,guide.width,guide.height);guide.hidden=false;}
  finally{URL.revokeObjectURL(url);}
 }
 function close(mode){if(busy)return;closed=true;stop();observer.disconnect();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);d.close();d.remove();result(mode);}
 async function start(){
  stop();resume.hidden=true;note.textContent='Opening camera…';
  try{
   const opened=await media.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:2560}}});
   if(closed||document.hidden){opened.getTracks().forEach(t=>t.stop());return;}
   stream=opened;video.srcObject=stream;await video.play();size();await showGuide();
   note.textContent=draft.sections.length?'Move down the receipt. Match the faint strip with the same printed lines.':'Keep the receipt straight and fill the width of the camera view.';
   controls();
  }catch(e){stop();note.textContent='Camera unavailable here. You can use the phone camera instead; captured sections are kept.';d.querySelector('.camera-fallback').hidden=false;}
 }
 function visibility(){if(document.hidden){stop();resume.hidden=false;note.textContent='Camera paused. Your photos are saved here.';}}
 function pagehide(){stop();}
 shutter.onclick=async()=>{
  if(busy||!stream||!video.videoWidth)return;busy=true;controls();note.textContent='Saving this section…';
  try{
   const c=document.createElement('canvas'),scale=Math.min(1,2600/Math.max(video.videoWidth,video.videoHeight));c.width=Math.round(video.videoWidth*scale);c.height=Math.round(video.videoHeight*scale);c.getContext('2d').drawImage(video,0,0,c.width,c.height);
   const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.94));if(!blob)throw new Error('Photo could not be captured');
   const next={...draft,sections:[...draft.sections,{original:new File([blob],`section-${draft.sections.length+1}.jpg`,{type:'image/jpeg'})}],index:draft.sections.length};
   await store.set('receipt-draft',next);draft=await store.get('receipt-draft');await showGuide();
   note.textContent='Section saved. Move down and match the faint strip, or save the receipt.';
  }catch(e){note.textContent='This section was not saved. '+e.message;}
  finally{busy=false;controls();}
 };
 save.onclick=()=>close('save');review.onclick=()=>close('review');d.querySelector('.camera-close').onclick=()=>close(null);d.oncancel=e=>{e.preventDefault();close(null);};resume.onclick=start;d.querySelector('.camera-fallback').onclick=()=>d.querySelector('.native-camera').click();
 d.querySelector('.native-camera').onchange=async e=>{
  const file=e.target.files[0];if(!file||busy)return;if(draft.sections.length>=20){note.textContent='Save this receipt before adding more sections.';return;}busy=true;controls();
  try{await store.set('receipt-draft',{...draft,sections:[...draft.sections,{original:file}],index:draft.sections.length});busy=false;close('review');}
  catch(error){note.textContent='This photo was not saved. '+error.message;busy=false;controls();}
 };
 const observer=new ResizeObserver(size);observer.observe(stage);video.onloadedmetadata=size;
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);document.body.append(d);d.showModal();d.querySelector('h2').focus();controls();
 if(media?.getUserMedia)await start();else{note.textContent='Use the phone camera to capture your receipt.';d.querySelector('.camera-fallback').hidden=false;}
 return done;
}
