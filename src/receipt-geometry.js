// Receipt geometry runs entirely on the device. No image leaves the browser here.
export const area=q=>Math.abs(q.reduce((s,p,i)=>{const n=q[(i+1)%q.length];return s+p.x*n.y-n.x*p.y;},0))/2;
export function validQuad(q){
  if(q.length!==4||area(q)<.015)return false;
  const turns=q.map((p,i)=>{const b=q[(i+1)%4],c=q[(i+2)%4];return (b.x-p.x)*(c.y-b.y)-(b.y-p.y)*(c.x-b.x);});
  return turns.every(v=>v>.0001);
}
export function fullQuad(){return [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];}
function hull(points){
  points.sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x),lo=[],hi=[];
  for(const p of points){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}
  for(const p of points.slice().reverse()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),p)<=0)hi.pop();hi.push(p);}
  return lo.slice(0,-1).concat(hi.slice(0,-1));
}
function fourCorners(points){
  const poly=hull(points);
  while(poly.length>4){let smallest=Infinity,index=0;for(let i=0;i<poly.length;i++){
    const a=poly[(i+poly.length-1)%poly.length],b=poly[i],c=poly[(i+1)%poly.length];
    const loss=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
    if(loss<smallest){smallest=loss;index=i;}
  }poly.splice(index,1);}
  if(poly.length!==4)return null;
  const first=poly.reduce((best,p,i)=>p.x+p.y<poly[best].x+poly[best].y?i:best,0);
  return poly.slice(first).concat(poly.slice(0,first));
}
export function detectReceipt({data,width:w,height:h}){
  const gray=new Uint8Array(w*h),hist=new Uint32Array(256);
  for(let i=0;i<gray.length;i++){gray[i]=Math.round(.299*data[4*i]+.587*data[4*i+1]+.114*data[4*i+2]);hist[gray[i]]++;}
  let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];
  let weight=0,part=0,bestVariance=0,cut=160;
  for(let i=0;i<255;i++){weight+=hist[i];part+=i*hist[i];if(!weight||weight===gray.length)continue;
    const difference=part/weight-(sum-part)/(gray.length-weight),variance=weight*(gray.length-weight)*difference*difference;
    if(variance>bestVariance){bestVariance=variance;cut=i;}}
  let best=null;
  for(const threshold of [...new Set([Math.max(85,cut+8),Math.max(120,cut+28),175,205])]){
    const visited=new Uint8Array(w*h),queue=new Int32Array(w*h);
    for(let seed=0;seed<gray.length;seed++){
      if(visited[seed]||gray[seed]<threshold)continue;
      let head=0,tail=1;queue[0]=seed;visited[seed]=1;const boundary=[];
      let border=0;
      while(head<tail){const i=queue[head++],x=i%w,y=Math.floor(i/w);let edge=false;
        if(x<2||y<2||x>w-3||y>h-3)border++;
        for(const n of [x>0?i-1:-1,x<w-1?i+1:-1,y>0?i-w:-1,y<h-1?i+w:-1]){
          if(n<0||gray[n]<threshold){edge=true;continue;}
          if(!visited[n]){visited[n]=1;queue[tail++]=n;}
        }
        if(edge)boundary.push({x,y});
      }
      if(tail<w*h*.08||border>Math.max(w,h)*.18)continue;
      let q=fourCorners(boundary);if(!q)continue;
      q=q.map(p=>({x:p.x/(w-1),y:p.y/(h-1)}));
      const fraction=area(q),fill=tail/(fraction*w*h);
      if(!validQuad(q)||fraction>.96||fill<.64||fill>1.12)continue;
      const score=fraction*Math.min(fill,1);
      if(!best||score>best.score)best={corners:q,score};
    }
  }
  if(!best)return {corners:fullQuad(),confident:false};
  // Keep a narrow margin around detected edges, protecting the first/last text lines.
  const cx=best.corners.reduce((s,p)=>s+p.x,0)/4,cy=best.corners.reduce((s,p)=>s+p.y,0)/4;
  return {corners:best.corners.map(p=>({x:Math.max(0,Math.min(1,cx+(p.x-cx)*1.025)),y:Math.max(0,Math.min(1,cy+(p.y-cy)*1.025))})),confident:true};
}
// Projective mapping from a unit rectangle into the original four corners.
export function projection(q){
  const [a,b,c,d]=q,dx1=b.x-c.x,dx2=d.x-c.x,dy1=b.y-c.y,dy2=d.y-c.y;
  const sx=a.x-b.x+c.x-d.x,sy=a.y-b.y+c.y-d.y,den=dx1*dy2-dx2*dy1;
  const g=Math.abs(den)<1e-12?0:(sx*dy2-dx2*sy)/den,h=Math.abs(den)<1e-12?0:(dx1*sy-sx*dy1)/den;
  const ax=b.x-a.x+g*b.x,bx=d.x-a.x+h*d.x,ay=b.y-a.y+g*b.y,by=d.y-a.y+h*d.y;
  return (u,v)=>{const z=g*u+h*v+1;return {x:(ax*u+bx*v+a.x)/z,y:(ay*u+by*v+a.y)/z};};
}
export const project=(q,u,v)=>projection(q)(u,v);
