import test from 'node:test';
import assert from 'node:assert/strict';
import {portraitCrop,portraitFrame} from '../src/capture-geometry.js';
import {categories,category} from '../src/categories.js';
test('landscape and portrait streams save precisely the portrait preview region',()=>{
 for(const [width,height] of [[1920,1080],[1920,2560],[1080,1920],[640,480]]){
  const r=portraitCrop(width,height);assert.equal(r.width/r.height,.75);assert.ok(r.x>=0&&r.y>=0);assert.equal(r.x*2+r.width,width);assert.equal(r.y*2+r.height,height);
  const f=portraitFrame(374,430);assert.equal(f.width/f.height,.75);assert.ok(f.width<=374&&f.height<=430);
 }
 assert.throws(()=>portraitCrop(0,0));
});
test('Check is available, Cash stays first, and receipt default is unchanged',()=>{assert.equal(categories[0],'Cash');assert.ok(categories.includes('Check'));assert.equal(category(''),'Personal - Credit Card');assert.equal(category('Personal Receipt'),'Personal - Credit Card');assert.equal(category('Check'),'Check');});
