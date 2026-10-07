import {PublicClientApplication,InteractionRequiredAuthError} from '@azure/msal-browser';
const BASE='https://graph.microsoft.com/v1.0';
// Shared collections require the delegated scope covering files shared with the user.
const scopes=['Files.ReadWrite.All'];
async function authDeadline(promise){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{const e=new Error('Microsoft sign-in did not respond. Tap Sign in to OneDrive to reconnect.');e.authRequired=true;reject(e);},20000);})]);}
  finally{clearTimeout(timer);}
}
async function timedFetch(url,options={},seconds=45){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),seconds*1000);
  try{return await fetch(url,{...options,signal:controller.signal});}
  catch(error){const e=new Error(error.name==='AbortError'?`OneDrive did not respond within ${seconds} seconds. Keep PaperDrop open to retry.`:'Cannot reach OneDrive. Check the internet connection and tap Refresh.');e.deliveryError=true;throw e;}
  finally{clearTimeout(timeout);}
}
export class OneDrive {
  constructor(config){this.config=config;}
  async init(){
    if(!this.config.clientId) return;
    this.auth=new PublicClientApplication({auth:{clientId:this.config.clientId,
      authority:'https://login.microsoftonline.com/common',redirectUri:new URL('./',location.href).href},
      cache:{cacheLocation:'localStorage'}});
    await authDeadline(this.auth.initialize());
    const result=await authDeadline(this.auth.handleRedirectPromise());
    if(result?.account)this.auth.setActiveAccount(result.account);
    else if(!this.auth.getActiveAccount())this.auth.setActiveAccount(this.auth.getAllAccounts()[0]||null);
  }
  async signIn(){
    if(!this.auth)throw new Error('Microsoft connection setup is not finished yet. You can still save receipts on this device.');
    await this.auth.loginRedirect({scopes,prompt:'select_account'});
  }
  async token(){
    if(!this.auth?.getActiveAccount()){const e=new Error('Connect OneDrive to deliver your saved receipts.');e.authRequired=true;throw e;}
    try{return (await authDeadline(this.auth.acquireTokenSilent({scopes,account:this.auth.getActiveAccount()}))).accessToken;}
    catch(e){if(e instanceof InteractionRequiredAuthError || ['monitor_window_timeout','iframe_closed_prematurely','silent_sso_error','no_tokens_found','refresh_token_expired'].includes(e.errorCode)){e.authRequired=true;e.message='Tap Sign in to resume OneDrive delivery. Your receipts are still saved on this device.';}throw e;}
  }
  async request(path,options={}){
    if(!path.startsWith('/'))throw new Error('Invalid OneDrive path');
    if(this.retryAfter>Date.now())throw new Error('OneDrive delivery will retry shortly.');
    const token=await this.token();
    const r=await timedFetch(BASE+path,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`}});
    if(r.status===429)this.retryAfter=Date.now()+Math.max(30,Number(r.headers.get('Retry-After'))||60)*1000;
    if(!r.ok){
      let code='';try{const body=await r.json();code=String(body.error?.code||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60);}catch{}
      const descriptions={401:'Sign in again to resume delivery.',403:'OneDrive denied access to the receipt folder.',404:'The selected OneDrive folder could not be found.',413:'OneDrive rejected the upload size.',429:'OneDrive is temporarily limiting requests. Delivery will retry.',507:'OneDrive storage is full.'};
      const e=new Error((descriptions[r.status]||'OneDrive could not complete delivery.')+` (OneDrive ${r.status}${code?' / '+code:''})`);
      e.status=r.status;e.authRequired=r.status===401;e.deliveryError=true;throw e;
    }
    return r.status===204?null:r.json();
  }
  item(target,path=''){
    const base=`/drives/${encodeURIComponent(target.drive)}/items/${encodeURIComponent(target.id)}`;
    if(path&&(path.includes('\\')||path.split('/').some(p=>['','.','..'].includes(p))))throw new Error('Invalid collection path');
    return path?`${base}:/${path.split('/').map(encodeURIComponent).join('/')}`:base;
  }
  async folders(target=null){
    let path=target?this.item(target)+'/children':'/me/drive/root/children';let items=[];
    do {
      const result=await this.request(path);
      items.push(...result.value.filter(r=>r.folder||r.remoteItem?.folder).map(r=>{
        const item=r.remoteItem||r;
        return {name:r.name,id:item.id,drive:item.parentReference.driveId};
      }));
      const next=result['@odata.nextLink'];
      if(next && !next.startsWith(BASE+'/'))throw new Error('Unexpected OneDrive response');
      path=next?next.slice(BASE.length):null;
    }while(path);
    return items;
  }
  async download(target,path){
    const item=await this.request(this.item(target,path));
    const url=item['@microsoft.graph.downloadUrl'];
    if(!url||new URL(url).protocol!=='https:')throw new Error('Document is not available to download.');
    // Pre-authorized URL: never forward the Microsoft access token to a storage host.
    const r=await timedFetch(url,{credentials:'omit'});if(!r.ok)throw new Error('Download unavailable');return r;
  }
  async catalog(target){return (await this.download(target,'PaperDrop Catalog/catalog.json')).json();}
  async upload(target,name,blob,resume={}){
    const path=this.item(target,'PaperDrop Inbox/'+name);
    const progress=(text)=>this.onProgress?.(text);
    const save=async(session)=>{resume.session=session;await resume.saveSession?.(session);};
    const sessionRequest=async(url,options={})=>{
      if(new URL(url).protocol!=='https:')throw new Error('Invalid upload session');
      // The upload URL is pre-authorized. Never send the Graph bearer token here.
      const response=await timedFetch(url,{...options,credentials:'omit'},90);
      if(!response.ok){const e=new Error(`OneDrive could not transfer this receipt (upload ${response.status}). Your saved copy is unchanged.`);e.status=response.status;e.deliveryError=true;throw e;}
      return {status:response.status,data:await response.json()};
    };
    let session=resume.session,offset=0;
    try{
      // Read in the page process before asking the network process to upload.
      // Safari can report the right size for an IndexedDB-backed File while
      // sending an empty body. ArrayBuffer bodies do not use that file handle.
      progress('Checking saved receipt…');
      let readTimer;
      let content;
      try{
        content=await Promise.race([blob.arrayBuffer(),new Promise((_,reject)=>{
          readTimer=setTimeout(()=>reject(new Error('Reading the saved receipt timed out.')),20000);
        })]);
        if(content.byteLength!==blob.size||!content.byteLength)throw new Error('Saved receipt size does not match its contents.');
        if(resume.digest){
          const hash=await crypto.subtle.digest('SHA-256',content);
          const digest=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
          if(digest!==resume.digest)throw new Error('Saved receipt contents did not pass verification.');
        }
      }catch(error){
        const e=new Error('PaperDrop could not read the saved receipt on this device. Your saved copy and original photos have been kept. '+error.message);
        e.receiptReadError=true;throw e;
      }finally{clearTimeout(readTimer);}
      if(session?.uploadUrl){
        progress('Resuming receipt upload…');
        try{
          const result=await sessionRequest(session.uploadUrl);
          offset=Number(result.data.nextExpectedRanges?.[0]?.split('-')[0]);
          if(!Number.isInteger(offset)||offset<0||offset>=blob.size)throw new Error('Invalid upload progress');
        }catch(e){
          if(e.status!==404&&e.status!==410)throw e;
          // Final response may have been lost after OneDrive committed the file.
          let item;try{item=await this.request(path);}catch(check){if(check.status!==404)throw check;}
          if(item?.size===blob.size){await save(null);return;}
          session=null;await save(null);
        }
      }
      if(!session){
        progress('Preparing receipt upload…');
        await this.ensureFolder(target,'PaperDrop Inbox');
        session=await this.request(path+':/createUploadSession',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item:{'@microsoft.graph.conflictBehavior':'replace',name}})});
        if(!session?.uploadUrl)throw new Error('OneDrive did not create an upload session');
        await save({uploadUrl:session.uploadUrl,expirationDateTime:session.expirationDateTime});
      }
      const chunk=327680;
      while(offset<blob.size){
        progress(`Uploading receipt — ${Math.floor(offset/blob.size*100)}%. Keep PaperDrop open.`);
        const end=Math.min(offset+chunk,blob.size);
        const result=await sessionRequest(session.uploadUrl,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Range':`bytes ${offset}-${end-1}/${blob.size}`},body:content.slice(offset,end)});
        if(result.status===200||result.status===201){
          if(end!==blob.size||result.data.size!==blob.size)throw new Error('OneDrive upload confirmation did not match the receipt');
          await save(null);progress('Receipt uploaded. Waiting for Surface processing.');return;
        }
        const next=Number(result.data.nextExpectedRanges?.[0]?.split('-')[0]);
        if(result.status!==202||next!==end||next>=blob.size)throw new Error('OneDrive returned unexpected upload progress');
        offset=next;
      }
      throw new Error('OneDrive did not confirm the completed receipt');
    }catch(error){
      if(error.deliveryError)error.message='Receipt upload: '+error.message;
      throw error;
    }
  }
  async ensureFolder(target,folder){
    try {await this.request(this.item(target,folder));}
    catch(e){if(e.status!==404)throw e;await this.request(this.item(target)+'/children',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:folder,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});}
  }
  async uploadInto(target,folder,name,blob){
    await this.ensureFolder(target,folder);
    await this.request(this.item(target,folder+'/'+name)+':/content',{
      method:'PUT',headers:{'Content-Type':blob.type||'application/octet-stream'},body:blob});
  }
  async submitAction(target,action){return this.uploadInto(target,'PaperDrop Actions',action.id+'.json',new Blob([JSON.stringify(action)],{type:'application/json'}));}
  async actionResult(target,id){
    try{return await (await this.download(target,'PaperDrop Actions/Results/'+id+'.json')).json();}
    catch(e){if(e.status===404)return null;throw e;}
  }
}
