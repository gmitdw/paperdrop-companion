// JPEG pages are embedded without recompression. Each section remains a separate page.
export async function receiptPdf(sections){
  if(!sections.length)throw new Error('Take a photo first.');
  const chunks=[],offsets=[0],encoder=new TextEncoder();let length=0;
  const bytes=value=>{const b=typeof value==='string'?encoder.encode(value):value;chunks.push(b);length+=b.length;};
  const object=(id,value)=>{offsets[id]=length;bytes(`${id} 0 obj\n${value}\nendobj\n`);};
  const stream=(id,head,data)=>{offsets[id]=length;bytes(`${id} 0 obj\n<< ${head} /Length ${data.length} >>\nstream\n`);bytes(data);bytes('\nendstream\nendobj\n');};
  bytes('%PDF-1.4\n');
  object(1,'<< /Type /Catalog /Pages 2 0 R >>');
  object(2,`<< /Type /Pages /Count ${sections.length} /Kids [${sections.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
  for(let i=0;i<sections.length;i++){
    const s=sections[i],id=3+i*3,w=612,h=+(w*s.height/s.width).toFixed(3);
    object(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Photo ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    stream(id+1,`/Type /XObject /Subtype /Image /Width ${s.width} /Height ${s.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,new Uint8Array(await s.blob.arrayBuffer()));
    stream(id+2,'',encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Photo Do Q`));
  }
  const xref=length;
  bytes(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for(const n of offsets.slice(1))bytes(`${String(n).padStart(10,'0')} 00000 n \n`);
  bytes(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new File(chunks,'Receipt.pdf',{type:'application/pdf'});
}
// One continuous PDF page; clipping JPEG strips avoids a giant iPhone canvas.
export async function stitchedReceiptPdf(sections,joins){
 if(!sections.length||joins.length!==sections.length-1)throw new Error('Receipt sections do not match their joins.');
 if(sections.some(s=>!Number.isFinite(s.width)||!Number.isFinite(s.height)||s.width<=0||s.height<=0))throw new Error('Invalid receipt image dimensions.');
 const width=128,layout=sections.map(s=>({top:0,bottom:0,x:0,height:s.height*width/s.width}));
 for(let i=0;i<joins.length;i++){
  const j=joins[i];
  if(!Number.isFinite(j.overlap)||!Number.isFinite(j.cut)||j.cut<0||j.cut>j.overlap||j.overlap<0||j.overlap>=Math.min(layout[i].height,layout[i+1].height)||!Number.isFinite(j.dx))throw new Error('Invalid receipt join');
  layout[i].bottom=j.overlap-j.cut;layout[i+1].top=j.cut;layout[i+1].x=layout[i].x-j.dx;
 }
 if(layout.some(s=>s.top+s.bottom>=s.height-8))throw new Error('These sections overlap too much. Check the joins.');
 const left=Math.min(...layout.map(s=>s.x)),right=Math.max(...layout.map(s=>s.x+width));
 const total=layout.reduce((n,s)=>n+s.height-s.top-s.bottom,0);
 const scale=Math.min(576/(right-left),13900/(total+8)),margin=4*scale,w=(right-left)*scale+2*margin,h=total*scale+2*margin;
 const chunks=[],offsets=[0],encoder=new TextEncoder();let length=0;
 const bytes=v=>{const b=typeof v==='string'?encoder.encode(v):v;chunks.push(b);length+=b.length;};
 const object=(id,v)=>{offsets[id]=length;bytes(`${id} 0 obj\n${v}\nendobj\n`);};
 const stream=(id,head,data)=>{offsets[id]=length;bytes(`${id} 0 obj\n<< ${head} /Length ${data.length} >>\nstream\n`);bytes(data);bytes('\nendstream\nendobj\n');};
 const n=v=>Number(v.toFixed(5));
 bytes('%PDF-1.4\n');object(1,'<< /Type /Catalog /Pages 2 0 R >>');object(2,'<< /Type /Pages /Count 1 /Kids [3 0 R] >>');
 object(3,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(w)} ${n(h)}] /Resources << /XObject << ${sections.map((s,i)=>`/Photo${i} ${5+i} 0 R`).join(' ')} >> >> /Contents 4 0 R >>`);
 let cursor=h-margin;const content=['1 1 1 rg',`0 0 ${n(w)} ${n(h)} re f`];
 for(let i=0;i<sections.length;i++){
  const s=layout[i],visible=(s.height-s.top-s.bottom)*scale,x=margin+(s.x-left)*scale;
  content.push(`q ${n(x)} ${n(cursor-visible)} ${n(width*scale)} ${n(visible)} re W n ${n(width*scale)} 0 0 ${n(s.height*scale)} ${n(x)} ${n(cursor-s.height*scale+s.top*scale)} cm /Photo${i} Do Q`);
  cursor-=visible;
 }
 stream(4,'',encoder.encode(content.join('\n')));
 for(let i=0;i<sections.length;i++){
  const s=sections[i];stream(5+i,`/Type /XObject /Subtype /Image /Width ${s.width} /Height ${s.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,new Uint8Array(await s.blob.arrayBuffer()));
 }
 const xref=length;bytes(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
 for(const offset of offsets.slice(1))bytes(`${String(offset).padStart(10,'0')} 00000 n \n`);
 bytes(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
 return new File(chunks,'Receipt.pdf',{type:'application/pdf'});
}
