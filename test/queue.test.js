import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store,deliver} from '../src/storage.js';
const target={drive:'drive',id:'receipts'};
const fresh=()=>new Store('test-'+crypto.randomUUID());
const receipt=()=>new File(['%PDF-1.4 receipt'], 'receipt.pdf',{type:'application/pdf'});
test('capture survives reopen; failed upload retains blob; retry and catalog acknowledge',async()=>{
 const store=fresh();await store.set('collection',target);const original=await store.save(receipt(),target);
 const reopened=new Store(store.name);assert.equal((await reopened.list()).length,1);
 const transport={catalog:async()=>({version:1,documents:[]}),upload:async()=>{throw new Error('offline');}};
 await assert.rejects(deliver(reopened,transport));assert.equal((await reopened.list())[0].state,'saved');
 let uploads=0;transport.upload=async()=>{uploads++;};await deliver(reopened,transport);await deliver(reopened,transport);
 assert.equal(uploads,1);assert.equal((await reopened.list())[0].state,'submitted');
 transport.catalog=async()=>({version:1,documents:[{digest:original.digest,status:'filed'}]});
 await deliver(reopened,transport);const row=(await reopened.list())[0];assert.equal(row.state,'filed');assert.ok(row.blob.size>0);
});
test('catalog failure does not block capture delivery',async()=>{
 const store=fresh();await store.set('collection',target);await store.save(receipt());
 const result=await deliver(store,{catalog:async()=>{throw new Error('missing');},upload:async()=>{}});
 assert.equal(result.catalogUnavailable,true);
 assert.equal((await store.list())[0].state,'submitted');
});
test('receipts cannot silently move between shared collections',async()=>{
 const store=fresh();await store.set('collection',{drive:'different',id:'other'});await store.save(receipt(),target);
 await deliver(store,{catalog:async()=>null,upload:async()=>{assert.fail('wrong collection');}});
 assert.equal((await store.list())[0].state,'saved');
});
test('empty and unsupported files are not acknowledged as saved',async()=>{
 const store=fresh();await assert.rejects(store.save(new File([],'blank.pdf')));
 await assert.rejects(store.save(new File(['x'],'code.exe')));assert.equal((await store.list()).length,0);
});
test('review changes persist, deliver once, and retain a conflict result',async()=>{
 const store=fresh();await store.set('collection',target);
 await store.action({id:4,digest:'abc',revision:'123'},'trash');
 let uploads=0;
 const transport={catalog:async()=>null,actionResult:async()=>null,submitAction:async()=>{uploads++;}};
 await deliver(store,transport);await deliver(store,transport);assert.equal(uploads,1);
 transport.actionResult=async(t,id)=>({id,state:'attention',message:'Changed elsewhere'});
 await deliver(store,transport);assert.equal((await store.actions())[0].state,'attention');
});

test('cropped receipt keeps the original locally and uploads only the crop',async()=>{
 const store=fresh();await store.set('collection',target);
 const original=new File(['original photo bytes'],'image.jpg',{type:'image/jpeg'});
 const cropped=new File(['cropped photo bytes'],'image-cropped.jpg',{type:'image/jpeg'});
 await store.save(cropped,target,original);
 const reopened=new Store(store.name),row=(await reopened.list())[0];
 assert.equal(await row.originalBlob.text(),'original photo bytes');
 let sent;await deliver(reopened,{catalog:async()=>({version:1,documents:[]}),upload:async(t,n,blob)=>{sent=await blob.text();}});
 assert.equal(sent,'cropped photo bytes');assert.equal(await (await reopened.list())[0].originalBlob.text(),'original photo bytes');
});

test('expired sign-in preserves all three receipt sections until reconnected',async()=>{
 const store=fresh();await store.set('collection',target);
 await store.save(receipt(),target,[new Blob(['section 1']),new Blob(['section 2']),new Blob(['section 3'])]);
 const transport={catalog:async()=>{const e=new Error('sign in');e.authRequired=true;throw e;},upload:async()=>assert.fail('must not upload without authentication')};
 await assert.rejects(deliver(store,transport));
 const reopened=new Store(store.name),saved=(await reopened.list())[0];
 assert.equal(saved.state,'saved');assert.equal(saved.originalBlob.length,3);assert.ok(saved.blob.size);
 transport.catalog=async()=>({version:1,documents:[]});transport.upload=async()=>{};
 await deliver(reopened,transport);assert.equal((await reopened.list())[0].state,'submitted');
});

test('unfinished sections survive reopening; completing a receipt atomically removes its draft',async()=>{
 const store=fresh(),sections=[{original:receipt(),blob:receipt()},{original:receipt(),blob:receipt()}];
 await store.set('receipt-draft',{sections,collection:target});
 const reopened=new Store(store.name);assert.equal((await reopened.get('receipt-draft')).sections.length,2);
 await assert.rejects(reopened.save(new File([],'empty.pdf'),target,null,true));
 assert.equal((await reopened.get('receipt-draft')).sections.length,2);assert.equal((await reopened.list()).length,0);
 await reopened.save(receipt(),target,sections.map(s=>s.original),true);
 assert.equal(await reopened.get('receipt-draft'),undefined);
 assert.equal((await reopened.list()).length,1);assert.equal((await reopened.list())[0].originalBlob.length,2);
});

test('three-section draft and final PDF persist as bytes, survive reopen, and upload with all pages',async()=>{
 const {receiptPdf}=await import('../src/receipt-pdf.js');
 const store=fresh();await store.set('collection',target);
 const sections=[1,2,3].map(n=>({width:120,height:300,original:new File(['original '+n],`photo${n}.jpg`,{type:'image/jpeg'}),blob:new Blob(['JPEG section '+n],{type:'image/jpeg'})}));
 await store.set('receipt-draft',{sections,collection:target});
 const rawDraft=await store.operation('settings','readonly',s=>s.get('receipt-draft'));
 assert.ok(rawDraft.sections.every(s=>s.original.bytes instanceof ArrayBuffer&&s.blob.bytes instanceof ArrayBuffer));
 const reopened=new Store(store.name),draft=await reopened.get('receipt-draft');
 const pdf=await receiptPdf(draft.sections),expected=await pdf.arrayBuffer();
 const row=await reopened.save(pdf,target,draft.sections.map(s=>s.original),true);
 const raw=await store.operation('receipts','readonly',s=>s.get(row.id));
 assert.ok(raw.blob.bytes instanceof ArrayBuffer);assert.ok(!(raw.blob instanceof Blob));
 assert.ok(raw.originalBlob.every(p=>p.bytes instanceof ArrayBuffer));
 const again=new Store(store.name);let uploaded;
 await deliver(again,{catalog:async()=>null,upload:async(t,n,blob)=>{uploaded=await blob.arrayBuffer();}});
 assert.deepEqual(uploaded,expected);
 const text=new TextDecoder().decode(uploaded);
 assert.match(text,/\/Count 3/);assert.ok(text.indexOf('JPEG section 1')<text.indexOf('JPEG section 2'));assert.ok(text.indexOf('JPEG section 2')<text.indexOf('JPEG section 3'));
 assert.equal((await again.list())[0].state,'submitted');assert.equal(await again.get('receipt-draft'),undefined);
});

test('failed persisted-PDF verification retains draft; retry uses the same record',async()=>{
 const store=fresh();await store.set('receipt-draft',{sections:[{original:receipt()}]});
 const operation=store.operation.bind(store);let damage=true;
 store.operation=async(name,mode,run)=>{
   const result=await operation(name,mode,run);
   if(damage&&name==='receipts'&&mode==='readonly'&&!Array.isArray(result)&&result?.blob?.bytes){
     damage=false;new Uint8Array(result.blob.bytes)[0]^=255;
   }
   return result;
 };
 await assert.rejects(store.save(receipt(),target,null,true),/verification/);
 assert.ok(await store.get('receipt-draft'));assert.equal((await store.list())[0].state,'saving');
 await store.save(receipt(),target,null,true);
 assert.equal((await store.list()).length,1);assert.equal((await store.list())[0].state,'saved');
 assert.equal(await store.get('receipt-draft'),undefined);
});

test('unreadable old receipt does not block new receipts; local removal only deletes chosen record',async()=>{
 const store=fresh();await store.set('collection',target);
 const broken=await store.save(receipt(),target),good=await store.save(receipt(),target);
 const list=store.list.bind(store);let reads=0;
 store.list=async()=> (await list()).map(row=>row.id===broken.id?{...row,blob:{size:10,arrayBuffer:async()=>{reads++;throw new Error('The object cannot be found here.');}}}:row);
 const sent=[];const transport={catalog:async()=>null,upload:async(t,name)=>sent.push(name)};
 await assert.rejects(deliver(store,transport),e=>e.receiptReadError);
 assert.deepEqual(sent,[`Receipt-${good.id}.pdf`]);
 await assert.rejects(deliver(store,transport));assert.equal(reads,1);
 await store.removeLocal(broken.id);assert.deepEqual((await list()).map(r=>r.id),[good.id]);
 await deliver(store,transport);assert.equal(sent.length,1);
});
