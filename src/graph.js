import {PublicClientApplication,InteractionRequiredAuthError} from '@azure/msal-browser';
const BASE='https://graph.microsoft.com/v1.0';
// Shared collections require the delegated scope covering files shared with the user.
const scopes=['Files.ReadWrite.All'];
async function timedFetch(url,options={}){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
  try{return await fetch(url,{...options,signal:controller.signal});}finally{clearTimeout(timeout);}
}
export class OneDrive {
  constructor(config){this.config=config;}
  async init(){
    if(!this.config.clientId) return;
    this.auth=new PublicClientApplication({auth:{clientId:this.config.clientId,
      authority:'https://login.microsoftonline.com/common',redirectUri:new URL('./',location.href).href},
      cache:{cacheLocation:'localStorage'}});
    await this.auth.initialize();
    const result=await this.auth.handleRedirectPromise();
    if(result?.account)this.auth.setActiveAccount(result.account);
    else if(!this.auth.getActiveAccount())this.auth.setActiveAccount(this.auth.getAllAccounts()[0]||null);
  }
  async signIn(){
    if(!this.auth)throw new Error('Microsoft connection setup is not finished yet. You can still save receipts on this device.');
    await this.auth.loginRedirect({scopes,prompt:'select_account'});
  }
  async token(){
    if(!this.auth?.getActiveAccount()){const e=new Error('Connect OneDrive to deliver your saved receipts.');e.authRequired=true;throw e;}
    try{return (await this.auth.acquireTokenSilent({scopes,account:this.auth.getActiveAccount()})).accessToken;}
    catch(e){if(e instanceof InteractionRequiredAuthError){e.authRequired=true;e.message='Sign in again to resume delivery. Your receipts are saved here.';}throw e;}
  }
  async request(path,options={}){
    if(!path.startsWith('/'))throw new Error('Invalid OneDrive path');
    if(this.retryAfter>Date.now())throw new Error('OneDrive delivery will retry shortly.');
    const token=await this.token();
    const r=await timedFetch(BASE+path,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`}});
    if(r.status===429)this.retryAfter=Date.now()+Math.max(30,Number(r.headers.get('Retry-After'))||60)*1000;
    if(!r.ok){const e=new Error(r.status===401?'Sign in again to resume delivery.':'OneDrive is unavailable. Your receipts are saved here.');e.status=r.status;e.authRequired=r.status===401;throw e;}
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
  async upload(target,name,blob){
    return this.uploadInto(target,'PaperDrop Inbox',name,blob);
  }
  async uploadInto(target,folder,name,blob){
    try {await this.request(this.item(target,folder));}
    catch(e){if(e.status!==404)throw e;await this.request(this.item(target)+'/children',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:folder,folder:{},'@microsoft.graph.conflictBehavior':'fail'})});}
    await this.request(this.item(target,folder+'/'+name)+':/content',{
      method:'PUT',headers:{'Content-Type':blob.type||'application/octet-stream'},body:blob});
  }
  async submitAction(target,action){return this.uploadInto(target,'PaperDrop Actions',action.id+'.json',new Blob([JSON.stringify(action)],{type:'application/json'}));}
  async actionResult(target,id){
    try{return await (await this.download(target,'PaperDrop Actions/Results/'+id+'.json')).json();}
    catch(e){if(e.status===404)return null;throw e;}
  }
}
