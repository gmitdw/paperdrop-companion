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
