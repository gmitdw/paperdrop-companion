import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
GlobalWorkerOptions.workerSrc=new URL('./pdf-worker-6.4.299.mjs',import.meta.url).href;
export async function reviewRotation(row,loadBlob,save){
 const d=document.createElement('dialog');d.className='rotation-dialog';
 d.innerHTML=`<h2 tabindex="-1">Rotate document</h2><p class="rotation-note" role="status">Opening document…</p><div class="rotation-stage"><canvas aria-label="Document orientation preview"></canvas></div><div class="rotation-controls"><button class="previous" aria-label="Previous page">‹</button><span class="page-label"></span><button class="next" aria-label="Next page">›</button></div><div class="rotation-controls"><button class="left">↶ Rotate left</button><button class="right">Rotate right ↷</button></div><p>Rotate each sideways page until the text is upright. Saving asks the Surface to read it again; the original is kept.</p><div class="actions"><button class="save primary">Save rotation</button><button class="close">Cancel</button></div>`;
 const canvas=d.querySelector('canvas'),note=d.querySelector('.rotation-note'),buttons=[...d.querySelectorAll('button')];let pdf,task,page=1,angles=[],busy=true,closed=false,saving=false;
 function controls(){for(const b of buttons)b.disabled=busy;d.querySelector('.close').disabled=saving;d.querySelector('.save').disabled=busy||!angles.some(a=>a);d.querySelector('.previous').disabled=busy||page<=1;d.querySelector('.next').disabled=busy||page>=angles.length;}
 async function draw(){
  busy=true;controls();try{const p=await pdf.getPage(page),rotation=(p.rotate+angles[page-1])%360;const base=p.getViewport({scale:1,rotation});const scale=Math.min(1200/base.width,1600/base.height);const v=p.getViewport({scale,rotation});canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);await p.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;d.querySelector('.page-label').textContent=`Page ${page} of ${pdf.numPages}`;note.textContent='Check that the text reads upright.';}finally{busy=false;if(!closed)controls();}
 }
 function close(){if(saving)return;closed=true;d.close();d.remove();task?.destroy()?.catch(()=>{});}
 d.querySelector('.close').onclick=close;d.oncancel=e=>{e.preventDefault();close();};
 for(const [name,delta] of [['left',270],['right',90]])d.querySelector('.'+name).onclick=()=>{angles[page-1]=(angles[page-1]+delta)%360;draw().catch(error);};
 for(const [name,delta] of [['previous',-1],['next',1]])d.querySelector('.'+name).onclick=()=>{page+=delta;draw().catch(error);};
 function error(e){if(closed)return;busy=false;controls();note.textContent='Could not show this document. '+e.message;}
 d.querySelector('.save').onclick=async()=>{saving=true;busy=true;controls();try{await save({rotations:angles});saving=false;busy=false;close();}catch(e){saving=false;busy=false;controls();note.textContent=e.message;}};
 document.body.append(d);d.showModal();d.querySelector('h2').focus();controls();
 try{const bytes=new Uint8Array(await (await loadBlob(row)).arrayBuffer());if(closed)return;task=getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true});pdf=await task.promise;angles=Array(pdf.numPages).fill(0);await draw();}catch(e){error(e);}
}
