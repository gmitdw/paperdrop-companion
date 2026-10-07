import {packFiles,unpackFiles,readBytes} from './durable-files.js';
// Resolve writes on transaction completion, never merely on a successful request.
export class Store {
  constructor(name='paperdrop-device-v1') { this.name=name;this.unreadable=new Set(); }
  async db() {
    if(this.connection) return this.connection;
    this.connection = await new Promise((resolve,reject)=>{
      const r=indexedDB.open(this.name,2);
      r.onupgradeneeded=()=>{
        if(!r.result.objectStoreNames.contains('receipts'))r.result.createObjectStore('receipts',{keyPath:'id'});
        if(!r.result.objectStoreNames.contains('settings'))r.result.createObjectStore('settings');
        if(!r.result.objectStoreNames.contains('actions'))r.result.createObjectStore('actions',{keyPath:'id'});
      };
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    }); return this.connection;
  }
  async operation(store,mode,run) {
    const db=await this.db();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,mode); let request;
      try {request=run(tx.objectStore(store));} catch(e){tx.abort();reject(e);return;}
      tx.oncomplete=()=>resolve(request?.result);
      tx.onerror=()=>reject(tx.error||new Error('Storage unavailable'));
      tx.onabort=()=>reject(tx.error||new Error('Receipt could not be saved'));
    });
  }
  async get(key){return unpackFiles(await this.operation('settings','readonly',s=>s.get(key)));}
  async set(key,value){const packed=await packFiles(value);return this.operation('settings','readwrite',s=>s.put(packed,key));}
  async list(){return unpackFiles(await this.operation('receipts','readonly',s=>s.getAll()));}
  async put(row){const packed=await packFiles(row,false);return this.operation('receipts','readwrite',s=>s.put(packed));}
  async removeLocal(id){await this.operation('receipts','readwrite',s=>s.delete(id));this.unreadable.delete(id);}
  actions(){return this.operation('actions','readonly',s=>s.getAll());}
  putAction(row){return this.operation('actions','readwrite',s=>s.put(row));}
  async action(row,action,fields={}) {
    for(const earlier of await this.actions()){
      if(earlier.doc_id!==row.id)continue;
      if(['saved','submitted'].includes(earlier.state))throw new Error('A change for this document is already waiting for the Surface.');
      if(earlier.state==='attention'){earlier.state='superseded';await this.putAction(earlier);}
    }
    await this.putAction({id:crypto.randomUUID(),action,doc_id:row.id,digest:row.digest,revision:row.revision,fields,state:'saved'});
  }
  async save(file,collection=null,originalBlob=null,finishDraft=false) {
    if(!file.size) throw new Error('This file is empty. Please choose another copy.');
    if(file.size>50*1024*1024) throw new Error('Please use a receipt smaller than 50 MB.');
    const ext=(file.name||'').split('.').pop().toLowerCase();
    if(!['pdf','jpg','jpeg','png','webp','tif','tiff','bmp'].includes(ext))
      throw new Error('Choose a PDF, JPG, PNG, WebP, TIFF or BMP. This file has not been saved.');
    const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    const digest=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
    const draft=finishDraft?await this.get('receipt-draft'):null;
    const row={id:draft?.receiptId||crypto.randomUUID(),name:file.name,ext,blob:file,digest,
      savedAt:new Date().toISOString(),state:'saving',collection,originalBlob};
    // Read every PDF/photo before opening the transaction. A failed read must
    // leave the draft intact and must never be acknowledged as a saved receipt.
    const packed=await packFiles(row);
    const packedDraft=draft?await packFiles({...draft,receiptId:row.id}):null;
    if(finishDraft){
      const db=await this.db();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(['receipts','settings'],'readwrite');
        tx.objectStore('receipts').put(packed);
        if(packedDraft)tx.objectStore('settings').put(packedDraft,'receipt-draft');
        tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Receipt could not be saved'));
      });
    }else await this.operation('receipts','readwrite',s=>s.put(packed));
    const stored=unpackFiles(await this.operation('receipts','readonly',s=>s.get(row.id)));
    const storedHash=await crypto.subtle.digest('SHA-256',await readBytes(stored.blob));
    if(Array.from(new Uint8Array(storedHash),n=>n.toString(16).padStart(2,'0')).join('')!==digest)
      throw new Error('The saved receipt did not pass verification. Your unfinished receipt has been kept.');
    // Only acknowledge the receipt and discard its draft after a read-back.
    row.state=packed.state='saved';
    const db=await this.db();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(['receipts','settings'],'readwrite');
      tx.objectStore('receipts').put(packed);
      if(finishDraft)tx.objectStore('settings').delete('receipt-draft');
      tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Receipt could not be verified'));
    });
    return row;
  }
}

export async function deliver(store,transport) {
  const target=await store.get('collection');
  if(!target) return {waiting:true};
    let catalog,catalogUnavailable=false;
  try {
    catalog=await transport.catalog(target);
      if(catalog?.version===1 && Array.isArray(catalog.documents)) await store.set('catalog',catalog);
      else catalogUnavailable=true;
  } catch(e) {
      if(e.authRequired) throw e;
      catalogUnavailable=true;
    // A temporarily unavailable catalog cannot prevent uploads.
  }
  const known=new Map((catalog?.documents||[]).map(r=>[r.digest,r]));
  let localReadFailure;
  for(const row of await store.list()) {
    if(row.collection && (row.collection.drive!==target.drive || row.collection.id!==target.id)) continue;
    const match=known.get(row.digest);
    if(match){row.state=match.status;await store.put(row);continue;}
    if(row.state!=='saved') continue;
    try{
      if(store.unreadable.has(row.id))throw new Error('Previously unreadable');
      // Detach readable legacy data before any metadata write can replace its
      // IndexedDB record. New rows already contain durable bytes on disk.
      row.blob=new Blob([await readBytes(row.blob)],{type:row.blob.type});
    }catch(error){
      store.unreadable.add(row.id);
      const e=new Error('An older saved receipt cannot be read on this device and needs to be retaken. Other receipts can still upload.');e.receiptReadError=true;
      localReadFailure ||= e;
      continue; // One unreadable receipt must not block every later receipt.
    }
    // Persist destination before uploading, so a later connection change cannot reroute a retry.
    row.collection=target; await store.put(row);
    await transport.upload(target,`Receipt-${row.id}.${row.ext}`,row.blob,{digest:row.digest,session:row.uploadSession,saveSession:async(session)=>{row.uploadSession=session;await store.put(row);}});
    row.state='submitted'; await store.put(row);
  }
  const actions=await store.actions();
  for(const action of actions){
    if(['done','attention','superseded'].includes(action.state))continue;
    const result=await transport.actionResult(target,action.id);
    if(result)Object.assign(action,result);
    else if(action.state==='saved'){await transport.submitAction(target,action);action.state='submitted';}
    await store.putAction(action);
  }
    if(localReadFailure)throw localReadFailure;
    return {waiting:false,catalogUnavailable};
}
