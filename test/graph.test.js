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
 await drive.uploadInto({drive:'d',id:'i'},'PaperDrop Inbox','Receipt-abc.pdf',new Blob(['receipt']));
 assert.equal(calls.at(-1)[0],'/drives/d/items/i:/PaperDrop%20Inbox/Receipt-abc.pdf:/content');
 assert.equal(calls.at(-1)[1].method,'PUT');
});

test('receipt uploads resume acknowledged chunks after interruption and app reopening',async()=>{
 const original=globalThis.fetch,blob=new Blob([new Uint8Array(700000)]),target={drive:'d',id:'i'};
 let saved=null,offset=0,fail=true,created=0;const ranges=[];
 function device(){const d=new OneDrive({});d.request=async(path,options)=>{
  if(path.endsWith('createUploadSession')){created++;return {uploadUrl:'https://upload.example/session'};}
  return {};
 };return d;}
 globalThis.fetch=async(url,options)=>{
  assert.equal(options.credentials,'omit');assert.equal(options.headers?.Authorization,undefined);
  if(!options.method)return new Response(JSON.stringify({nextExpectedRanges:[offset+'-']}));
  if(fail&&offset===327680){fail=false;throw new TypeError('connection interrupted');}
  assert.ok(options.body instanceof ArrayBuffer);
  ranges.push(options.headers['Content-Range']);offset+=options.body.byteLength;
  return new Response(JSON.stringify(offset===blob.size?{size:blob.size}:{nextExpectedRanges:[offset+'-']}),{status:offset===blob.size?201:202});
 };
 const resume=()=>({session:saved,saveSession:async(s)=>{saved=s;}});
 try{
  await assert.rejects(device().upload(target,'Receipt-abc.pdf',blob,resume()));assert.ok(saved);assert.equal(offset,327680);
  await device().upload(target,'Receipt-abc.pdf',blob,resume());assert.equal(created,1);assert.equal(saved,null);
  assert.deepEqual(ranges,['bytes 0-327679/700000','bytes 327680-655359/700000','bytes 655360-699999/700000']);
 }finally{globalThis.fetch=original;}
});

test('lost final response is acknowledged without uploading a duplicate receipt',async()=>{
 const original=globalThis.fetch,drive=new OneDrive({}),blob=new Blob(['receipt']);let saved='pending';
 drive.request=async()=>({size:blob.size});
 globalThis.fetch=async()=>new Response('{}',{status:404});
 try{await drive.upload({drive:'d',id:'i'},'Receipt-abc.pdf',blob,{session:{uploadUrl:'https://upload.example/session'},saveSession:async s=>{saved=s;}});assert.equal(saved,null);}
 finally{globalThis.fetch=original;}
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

test('unreadable or changed receipt bytes are distinguished from OneDrive failures before any request',async()=>{
 const drive=new OneDrive({});drive.request=async()=>assert.fail('must verify local bytes before contacting OneDrive');
 await assert.rejects(drive.upload({drive:'d',id:'i'},'Receipt.pdf',{size:7,arrayBuffer:async()=>{throw new Error('NotReadableError');}}),e=>e.receiptReadError&&!e.deliveryError);
 await assert.rejects(drive.upload({drive:'d',id:'i'},'Receipt.pdf',new Blob(['changed']),{digest:'bad'}),e=>e.receiptReadError&&e.message.includes('verification'));
});

test('real HTTP receiver obtains exact bytes from all chunks without Blob request bodies',async()=>{
 const {createServer}=await import('node:http');
 const received=[];let size=0;
 const payload=Uint8Array.from({length:800123},(_,i)=>i%251),blob=new Blob([payload]);
 const server=createServer(async(req,res)=>{
   const parts=[];for await(const part of req)parts.push(part);
   const body=Buffer.concat(parts);received.push(body);size+=body.length;
   assert.equal(Number(req.headers['content-length']),body.length);
   res.writeHead(size===blob.size?201:202,{'Content-Type':'application/json'});
   res.end(JSON.stringify(size===blob.size?{size}:{nextExpectedRanges:[size+'-']}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const original=globalThis.fetch,drive=new OneDrive({});
 drive.request=async path=>path.endsWith('createUploadSession')?{uploadUrl:'https://upload.example/test'}:{};
 globalThis.fetch=(url,options)=>{
   assert.ok(options.body instanceof ArrayBuffer,'do not hand a stored Blob to the network process');
   return original(`http://127.0.0.1:${server.address().port}/test`,options);
 };
 try{
   await drive.upload({drive:'d',id:'i'},'Receipt.pdf',blob);
   assert.equal(received.length,3);assert.deepEqual(Buffer.concat(received),Buffer.from(payload));
 }finally{globalThis.fetch=original;await new Promise(resolve=>server.close(resolve));}
});
