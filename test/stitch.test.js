import test from 'node:test';
import assert from 'node:assert/strict';
import {matchSections,seamRow,inkImage} from '../src/receipt-match.js';
function longReceipt(height=1200,repeated=false){
 const width=128,ink=new Float32Array(width*height);let seed=431;
 const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
 for(let y=12;y<height-10;y+=22){
  if(repeated)seed=431;
  for(let x=10;x<116;x+=7){const h=3+Math.floor(random()*8),w=2+Math.floor(random()*4);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)ink[yy*width+xx]=.5+random()*.45;}
 }
 return {width,height,ink};
}
function section(full,start,height,shift=0){const ink=new Float32Array(full.width*height);for(let y=0;y<height;y++)for(let x=0;x<full.width;x++){const source=x-shift;if(source>=0&&source<full.width)ink[y*full.width+x]=full.ink[(y+start)*full.width+source];}return {width:full.width,height,ink};}
test('aligns three distinct sections and removes exactly their shared rows',()=>{
 const full=longReceipt(),a=section(full,0,420),b=section(full,280,430),c=section(full,575,430);
 const ab=matchSections(a,b),bc=matchSections(b,c);
 assert.equal(ab.overlap,140);assert.equal(bc.overlap,135);assert.ok(ab.confident);assert.ok(bc.confident);
 assert.equal(a.height+b.height+c.height-ab.overlap-bc.overlap,1005);
 for(const [x,y,m] of [[a,b,ab],[b,c,bc]]){const cut=seamRow(x,y,m.overlap,m.dx);assert.ok(cut>0&&cut<m.overlap);}
});
test('corrects sideways displacement while retaining the same receipt lines',()=>{
 const full=longReceipt(),m=matchSections(section(full,0,420),section(full,280,430,3));assert.equal(m.dx,3);assert.equal(m.overlap,140);assert.ok(m.confident);
});
test('blank paper, repeated patterns, a gap, and duplicate photos require a check',()=>{
 const full=longReceipt(),repeat=longReceipt(1200,true),blank={width:128,height:400,ink:new Float32Array(51200)};
 assert.equal(matchSections(blank,blank).confident,false);
 assert.equal(matchSections(section(repeat,0,420),section(repeat,286,420)).confident,false);
 assert.equal(matchSections(section(full,0,420),section(full,500,420)).confident,false);
 assert.equal(matchSections(section(full,0,420),section(full,0,420)).confident,false);
});
test('ink matching tolerates different paper brightness in neighboring photos',()=>{
 const full=longReceipt();function image(s,paper){const data=new Uint8ClampedArray(s.width*s.height*4);for(let i=0;i<s.ink.length;i++){data[4*i]=data[4*i+1]=data[4*i+2]=paper*(1-s.ink[i]);data[4*i+3]=255;}return inkImage({...s,data});}
 const m=matchSections(image(section(full,0,420),245),image(section(full,280,430),180));assert.ok(m.confident);assert.equal(m.overlap,140);
});
