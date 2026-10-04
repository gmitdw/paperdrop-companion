import test from 'node:test';
import assert from 'node:assert/strict';
import {detectReceipt,fullQuad,validQuad,project} from '../src/receipt-geometry.js';
function fixture(q,background=40){
  const width=240,height=320,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p={x:x/width,y:y/height};
    const inside=q.every((a,i)=>{const b=q[(i+1)%4];return (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)>=0;});
    const ink=inside&&y%13<2&&x>width*.35&&x<width*.6;
    const shade=inside?(ink?55:235):background,index=4*(y*width+x);
    data[index]=data[index+1]=data[index+2]=shade;data[index+3]=255;
  }return {data,width,height};
}
test('detects and preserves all four edges of a skewed long receipt',()=>{
  const q=[{x:.28,y:.07},{x:.7,y:.12},{x:.65,y:.91},{x:.22,y:.86}];
  const result=detectReceipt(fixture(q));assert.equal(result.confident,true);
  for(let i=0;i<4;i++)assert.ok(Math.hypot(result.corners[i].x-q[i].x,result.corners[i].y-q[i].y)<.04);
});
test('unclear white-on-white photo keeps the full image',()=>{
  const result=detectReceipt(fixture(fullQuad(),235));assert.equal(result.confident,false);assert.deepEqual(result.corners,fullQuad());
});
test('blank dark image does not invent receipt edges',()=>{
  const result=detectReceipt({data:new Uint8ClampedArray(80*80*4),width:80,height:80});assert.equal(result.confident,false);
});
test('perspective transform maps all output corners to source corners',()=>{
  const q=[{x:25,y:10},{x:180,y:30},{x:170,y:280},{x:10,y:260}];
  for(const [i,u,v] of [[0,0,0],[1,1,0],[2,1,1],[3,0,1]]){const p=project(q,u,v);assert.ok(Math.abs(p.x-q[i].x)<1e-8&&Math.abs(p.y-q[i].y)<1e-8);}
});
test('crossed and tiny manual crops are rejected',()=>{
  const q=fullQuad();assert.equal(validQuad([q[0],q[2],q[1],q[3]]),false);
  assert.equal(validQuad(q.map(p=>({x:p.x*.02,y:p.y*.02}))),false);assert.equal(validQuad(q),true);
});
