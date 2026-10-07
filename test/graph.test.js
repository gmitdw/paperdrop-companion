import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OneDrive} from '../src/graph.js';
test('document paths stay within the selected collection',()=>{
 const drive=new OneDrive({});const target={drive:'drive',id:'folder'};
 assert.equal(drive.item(target,'PaperDrop Filed/2026/100426  Store  12.34.pdf'),'/drives/drive/items/folder:/PaperDrop%20Filed/2026/100426%20%20Store%20%2012.34.pdf');
 for(const path of ['../other.pdf','/root.pdf','folder/../other.pdf','folder\\other.pdf'])assert.throws(()=>drive.item(target,path));
});
test('upload uses a stable UUID filename and content endpoint',async()=>{
 const drive=new OneDrive({});const calls=[];drive.request=async(path,options)=>{calls.push([path,options]);return {};};
 await drive.upload({drive:'d',id:'i'},'Receipt-abc.pdf',new Blob(['receipt']));
 assert.equal(calls.at(-1)[0],'/drives/d/items/i:/PaperDrop%20Inbox/Receipt-abc.pdf:/content');
 assert.equal(calls.at(-1)[1].method,'PUT');
});

test('blocked silent sign-in requests an explicit reconnect instead of retrying forever',async()=>{
 const drive=new OneDrive({});
 drive.auth={getActiveAccount:()=>({}),acquireTokenSilent:async()=>{const error=new Error('iframe timeout');error.errorCode='monitor_window_timeout';throw error;}};
 await assert.rejects(drive.token(),error=>error.authRequired===true && error.message.includes('Sign in'));
 drive.auth.acquireTokenSilent=async()=>{throw new Error('network offline');};
 await assert.rejects(drive.token(),error=>!error.authRequired);
});

test('OneDrive rejection preserves a safe diagnostic code and does not expose server details',async()=>{
 const drive=new OneDrive({});drive.token=async()=>'test-token';
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{code:'accessDenied',message:'private server details'}}),{status:403});
  await assert.rejects(drive.request('/test'),e=>e.deliveryError && e.status===403 && e.message.includes('403 / accessDenied') && !e.message.includes('private'));
  globalThis.fetch=async()=>{throw new TypeError('fetch failed');};
  await assert.rejects(drive.request('/test'),e=>e.deliveryError && e.message.includes('Cannot reach OneDrive'));
 }finally{globalThis.fetch=original;}
});
