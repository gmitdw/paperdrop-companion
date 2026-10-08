// Match ink patterns, not white paper. Inputs share the same normalized width.
export function inkImage(image){
 const {width,height,data}=image,ink=new Float32Array(width*height);
 for(let y=0;y<height;y++){
  const row=[];for(let x=0;x<width;x++){const p=(y*width+x)*4;row.push(.299*data[p]+.587*data[p+1]+.114*data[p+2]);}
  const sorted=[...row].sort((a,b)=>a-b),paper=sorted[Math.floor(width*.9)];
  for(let x=0;x<width;x++)ink[y*width+x]=Math.max(0,(paper-row[x]-8)/Math.max(80,paper));
 }
 return {width,height,ink};
}
function correlation(a,b,overlap,dx=0){
 const width=a.width,aa=a.ink,bb=b.ink;
 let ab=0,a2=0,b2=0,active=0;
 for(let y=0;y<overlap;y++){
  let row=0;
  for(let x=6;x<width-6;x++){
   const q=x+dx;if(q<0||q>=width)continue;
   const av=aa[(a.height-overlap+y)*width+x],bv=bb[y*width+q];
   ab+=av*bv;a2+=av*av;b2+=bv*bv;row+=av+bv;
  }
  if(row>.5)active++;
 }
 return {score:a2>1&&b2>1?ab/Math.sqrt(a2*b2):0,active};
}
export function matchSections(a,b){
 if(a.width!==b.width)throw new Error('Receipt widths must be normalized');
 const min=Math.max(24,Math.floor(Math.min(a.height,b.height)*.06)),max=Math.min(512,Math.floor(Math.min(a.height,b.height)*.65));
 const fine=[];
 for(let overlap=min;overlap<=max;overlap++)for(let dx=-4;dx<=4;dx++)fine.push({overlap,dx,...correlation(a,b,overlap,dx)});
 fine.sort((a,b)=>b.score-a.score);
 const best=fine[0]||{overlap:0,dx:0,score:0,active:0};
 const alternative=fine.find(c=>Math.abs(c.overlap-best.overlap)>6);
 const margin=best.score-(alternative?.score||0);
 return {...best,confident:best.score>=.88&&margin>=.045&&best.active>=12,margin};
}
// Choose a low-ink row in the shared region so a tiny alignment error cannot
// cut a glyph at the seam. Manual joins also use this rule.
export function seamRow(a,b,overlap,dx=0){
 if(!overlap)return 0;
 let best=Math.round(overlap/2),score=Infinity;
 for(let y=Math.ceil(overlap*.2);y<Math.floor(overlap*.8);y++){
  let sum=0;
  for(let yy=Math.max(0,y-1);yy<=Math.min(overlap-1,y+1);yy++)for(let x=6;x<a.width-6;x++){
   const xx=x+dx;if(xx<0||xx>=b.width)continue;
   sum+=a.ink[(a.height-overlap+yy)*a.width+x]+b.ink[yy*b.width+xx];
  }
  sum+=Math.abs(y-overlap/2)*.001;
  if(sum<score){score=sum;best=y;}
 }
 return best;
}
// Level paper brightness between shots without thresholding away faint ink.
// The original color photos remain in the saved receipt record.
export function balancePaper(image){
 const {data}=image,histogram=new Uint32Array(256);let count=0;
 for(let p=0;p<data.length;p+=64){const value=Math.round(.299*data[p]+.587*data[p+1]+.114*data[p+2]);histogram[value]++;count++;}
 let total=0,paper=255;for(let i=0;i<256;i++){total+=histogram[i];if(total>=count*.9){paper=i;break;}}
 const gain=255/Math.max(160,paper);
 for(let p=0;p<data.length;p+=4){const value=Math.min(255,Math.round((.299*data[p]+.587*data[p+1]+.114*data[p+2])*gain));data[p]=data[p+1]=data[p+2]=value;data[p+3]=255;}
 return image;
}
