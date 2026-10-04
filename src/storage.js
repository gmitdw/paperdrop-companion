// Resolve writes on transaction completion, never merely on a successful request.
export class Store {
  constructor(name='paperdrop-device-v1') { this.name=name; }
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
  get(key){return this.operation('settings','readonly',s=>s.get(key));}
  set(key,value){return this.operation('settings','readwrite',s=>s.put(value,key));}
  list(){return this.operation('receipts','readonly',s=>s.getAll());}
  put(row){return this.operation('receipts','readwrite',s=>s.put(row));}
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
  async save(file,collection=null) {
    if(!file.size) throw new Error('This file is empty. Please choose another copy.');
    if(file.size>50*1024*1024) throw new Error('Please use a receipt smaller than 50 MB.');
    const ext=(file.name||'').split('.').pop().toLowerCase();
    if(!['pdf','jpg','jpeg','png','webp','tif','tiff','bmp'].includes(ext))
      throw new Error('Choose a PDF, JPG, PNG, WebP, TIFF or BMP. This file has not been saved.');
    const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    const digest=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
    const row={id:crypto.randomUUID(),name:file.name,ext,blob:file,digest,
      savedAt:new Date().toISOString(),state:'saved',collection};
    await this.put(row); return row;
  }
}

export async function deliver(store,transport) {
  const target=await store.get('collection');
  if(!target) return {waiting:true};
  let catalog;
  try {
    catalog=await transport.catalog(target);
    if(catalog?.version===1 && Array.isArray(catalog.documents)) await store.set('catalog',catalog);
  } catch(e) {
    if(e.authRequired) throw e;
    // A temporarily unavailable catalog cannot prevent uploads.
  }
  const known=new Map((catalog?.documents||[]).map(r=>[r.digest,r]));
  for(const row of await store.list()) {
    if(row.collection && (row.collection.drive!==target.drive || row.collection.id!==target.id)) continue;
    const match=known.get(row.digest);
    if(match){row.state=match.status;await store.put(row);continue;}
    if(row.state!=='saved') continue;
    // Persist destination before uploading, so a later connection change cannot reroute a retry.
    row.collection=target; await store.put(row);
    await transport.upload(target,`Receipt-${row.id}.${row.ext}`,row.blob);
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
  return {waiting:false};
}
