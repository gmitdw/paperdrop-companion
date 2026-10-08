import {inkImage,matchSections,seamRow,balancePaper} from './receipt-match.js';
import {stitchedReceiptPdf} from './receipt-pdf.js';
async function prepare(section){
 const url=URL.createObjectURL(section.blob),img=new Image();
 try{
  img.src=url;await img.decode();const full=document.createElement('canvas');full.width=section.width;full.height=section.height;
  const ctx=full.getContext('2d');ctx.drawImage(img,0,0,full.width,full.height);
  ctx.putImageData(balancePaper(ctx.getImageData(0,0,full.width,full.height)),0,0);
  const blob=await new Promise(resolve=>full.toBlob(resolve,'image/jpeg',.94));if(!blob)throw new Error('Could not prepare receipt section');
  const c=document.createElement('canvas');c.width=128;c.height=Math.round(128*section.height/section.width);
  if(c.height>4096||c.height<24)throw new Error('This section is too narrow to align. Adjust its edges or retake it.');
  c.getContext('2d').drawImage(full,0,0,c.width,c.height);full.width=full.height=1;
  return {section:{...section,blob},image:{canvas:c,...inkImage(c.getContext('2d').getImageData(0,0,c.width,c.height))}};
 }finally{URL.revokeObjectURL(url);}
}
async function checkJoin(a,b,guess,index){
 const d=document.createElement('dialog');d.className='join-dialog';d.innerHTML=`<h2 tabindex="-1">Check this join</h2><p class="join-help"></p><canvas aria-label="Preview of the receipt join"></canvas><label>Overlap <input class="join-overlap" type="range" step="1"></label><label>Move next section sideways <input class="join-shift" type="range" min="-12" max="12" step="1"></label><p>Match the printed lines. Nothing should appear twice or be missing. If the sections do not overlap, retake the next section.</p><div class="actions"><button class="join-cancel">Back to sections</button><button class="join-use primary">Use this join</button></div>`;
 d.querySelector('.join-help').textContent=`Sections ${index+1} and ${index+2} could not be matched confidently. Adjust the overlap, then check the join below.`;
 const slider=d.querySelector('.join-overlap'),shift=d.querySelector('.join-shift'),view=d.querySelector('canvas');
 slider.min=0;slider.max=Math.floor(Math.min(a.height,b.height)*.65);slider.value=guess.overlap||Math.floor(Number(slider.max)/3);shift.value=guess.dx||0;
 function draw(){
  const overlap=Number(slider.value),dx=Number(shift.value),cut=seamRow(a,b,overlap,dx),top=a.height-overlap+cut;
  view.width=512;view.height=640;const ctx=view.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,512,640);
  ctx.save();ctx.scale(4,4);ctx.drawImage(a.canvas,0,Math.max(0,top-80),128,Math.min(80,top),0,80-Math.min(80,top),128,Math.min(80,top));
  ctx.drawImage(b.canvas,0,cut,128,Math.min(80,b.height-cut),-dx,80,128,Math.min(80,b.height-cut));ctx.restore();
  ctx.strokeStyle='#c03c36';ctx.setLineDash([8,6]);ctx.beginPath();ctx.moveTo(0,320);ctx.lineTo(512,320);ctx.stroke();
 }
 slider.oninput=shift.oninput=draw;document.body.append(d);d.showModal();d.querySelector('h2').focus();draw();
 return new Promise(resolve=>{const close=result=>{d.close();d.remove();resolve(result);};d.oncancel=e=>{e.preventDefault();close(null);};d.querySelector('.join-cancel').onclick=()=>close(null);d.querySelector('.join-use').onclick=()=>close({overlap:Number(slider.value),dx:Number(shift.value),manual:true});});
}
export async function stitchReceipt(sections,onProgress=()=>{},onRetake=()=>{}){
 const images=[],balanced=[];for(const section of sections){const result=await prepare(section);images.push(result.image);balanced.push(result.section);}
 const joins=[];
 for(let i=0;i<images.length-1;i++){
  onProgress(`Aligning sections ${i+1} and ${i+2}…`);await new Promise(resolve=>setTimeout(resolve,0));
  let match=matchSections(images[i],images[i+1]);
  if(!match.confident){match=await checkJoin(images[i],images[i+1],match,i);if(!match){onRetake(i+1);return null;}}
  joins.push({...match,cut:seamRow(images[i],images[i+1],match.overlap,match.dx)});
 }
 return stitchedReceiptPdf(balanced,joins);
}
