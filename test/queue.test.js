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
 await deliver(store,{catalog:async()=>{throw new Error('missing');},upload:async()=>{}});
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
