import {installItemReview} from './receipt-items.js';
import {newestReceiptFirst} from './document-order.js';
import {cropReceipt} from './receipt-crop.js';
import {captureReceiptCamera} from './receipt-camera.js';
import {Store,deliver} from './storage.js';
import {OneDrive} from './graph.js';
import {connectionStatus} from './connection-status.js';
const $=id=>document.getElementById(id), store=new Store();
let drive,filter='all',busy=false,folderStack=[],reviewRow,signInNeeded=false;
const say=text=>{$('status').textContent=text;};
let connectionState='checking';
const connectionPanel=document.createElement('section');connectionPanel.id='connection-status';connectionPanel.setAttribute('aria-label','OneDrive delivery');
const connectionTitle=document.createElement('strong'),connectionText=document.createElement('p'),connectionAction=document.createElement('button');
connectionTitle.setAttribute('role','status');connectionPanel.append(connectionTitle,connectionText,connectionAction);
document.querySelector('header').after(connectionPanel);
function showConnection(state,detail=''){
  connectionState=state;const info=connectionStatus(state);
  connectionPanel.dataset.state=state;connectionTitle.textContent=info.title;connectionText.textContent=detail||info.text;
  connectionAction.textContent=info.action||'';connectionAction.hidden=!info.action;
  $('connect').textContent=state==='signin'?'Sign in to OneDrive':state==='setup'?'Connect OneDrive':state==='folder'?'Choose receipt folder':'Check connection';
  $('connect').disabled=state==='checking';
}
connectionAction.onclick=()=>['signin','setup','folder'].includes(connectionState)?$('connect').click():sync();
showConnection('checking');
const showItems=installItemReview({store,sync,say,openDocument});
const labels={saving:'Saving…',saved:'Not uploaded',submitted:'Waiting for Surface',review:'Review',filed:'Filed'};

async function render(){
  $('resume-receipt').hidden=!(await store.get('receipt-draft'));
  const catalog=await store.get('catalog'), local=await store.list();
  const waiting=new Set((await store.actions()).filter(a=>['saved','submitted'].includes(a.state)).map(a=>a.doc_id));
  const known=new Set([...(catalog?.documents||[]).map(r=>r.digest),...(catalog?.removed||[])]);
  const rows=[...local.filter(r=>!known.has(r.digest)),...(catalog?.documents||[])].sort(newestReceiptFirst);
  const terms=$('search').value.toLowerCase().split(/\s+/).filter(Boolean);
  const container=$('documents');container.replaceChildren();
  for(const row of rows){
    const state=row.status||row.state;
    if(filter==='waiting'&&['filed','review'].includes(state))continue;
    if(['filed','review'].includes(filter)&&state!==filter)continue;
    const haystack=[row.filename,row.name,row.vendor,row.date,row.amount,row.kind,row.text].join(' ').toLowerCase();
    if(!terms.every(t=>haystack.includes(t)))continue;
    const button=document.createElement('button');button.className='document';
    const icon=document.createElement('span');icon.className='doc-icon';icon.textContent='▤';icon.setAttribute('aria-hidden','true');
    const info=document.createElement('span');info.className='doc-info';
    const title=document.createElement('span');title.className='doc-title';title.textContent=row.filename||row.name;
    const detail=document.createElement('span');detail.className='doc-detail';detail.textContent=[row.vendor,row.date,row.amount?`$${row.amount}`:null].filter(Boolean).join(' · ')||new Date(row.savedAt).toLocaleString();
    const badge=document.createElement('span');badge.className='badge';badge.textContent=labels[state]||state;
    if(store.unreadable.has(row.id))badge.textContent='Needs retake';
    if(waiting.has(row.id))badge.textContent='Change waiting';
    info.append(title,detail);button.append(icon,info,badge);button.onclick=()=>openDocument(row);
    const item=document.createElement('div');item.className='document-row';item.append(button);
    if(row.revision){const edit=document.createElement('button');edit.className='more-button';edit.textContent='•••';edit.setAttribute('aria-label','More options for '+(row.filename||row.name));edit.setAttribute('aria-haspopup','dialog');edit.onclick=()=>showOptions(row);item.append(edit);}
    else if(row.blob){
      const more=document.createElement('button');more.className='more-button';more.textContent='•••';
      more.setAttribute('aria-label','More options for '+row.name);more.setAttribute('aria-expanded','false');
      const remove=document.createElement('button');remove.textContent='Remove from this device';remove.hidden=true;
      more.onclick=()=>{remove.hidden=!remove.hidden;more.setAttribute('aria-expanded',String(!remove.hidden));};
      remove.onclick=async()=>{
        if(busy){say('Please wait for the current delivery check to finish, then remove this receipt.');return;}
        if(!confirm(`Remove ${row.name} from this device? Its locally saved copy and photos will be deleted. Any copy already uploaded to OneDrive will stay there.`))return;
        try{await store.removeLocal(row.id);say('Removed from this device.');await render();await sync();}
        catch(e){say('The receipt was not removed. '+e.message);}
      };
      item.append(more,remove);
    }
    container.append(item);
  }
  if(!container.children.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=terms.length?'No matching documents.':'Your receipts will appear here.\nStart with a photo or a file.';container.append(empty);}
  $('catalog-date').textContent=catalog?.updated?`Collection updated ${new Date(catalog.updated).toLocaleString()}.`:'Saved receipts stay here while the shared collection connects.';
}

async function openDocument(row){
  const viewer=window.open('about:blank','_blank');
  if(viewer)viewer.opener=null;
  try{
    let blob=row.blob;
    if(!blob){
      const key='pdf:'+row.digest+':'+row.pdf;
      blob=await store.get(key);
      if(!blob){
        say('Downloading your document…');
        const target=await store.get('collection');if(!target)throw new Error('Connect OneDrive to open this document.');
        blob=await (await drive.download(target,row.pdf)).blob();await store.set(key,blob);
      }
    }
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.target='_blank';link.rel='noopener';
    if(viewer)viewer.location.replace(url);else {document.body.append(link);link.click();link.remove();}
    setTimeout(()=>URL.revokeObjectURL(url),300000);
    say('Document opened. A copy is available here offline.');
  }catch(e){if(viewer)viewer.close();say(e.authRequired?e.message:'This document is not downloaded here yet. Reconnect to the internet and try again.');}
}

let optionsRow;
function showOptions(row){
  optionsRow=row;$('options-title').textContent=row.filename||row.name;
  $('options-dialog').showModal();$('options-review').focus({preventScroll:true});
}
$('options-review').onclick=()=>{$('options-dialog').close();review(optionsRow);};
$('options-items').onclick=()=>{$('options-dialog').close();showItems(optionsRow);};
$('review-items').onclick=()=>{$('review-dialog').close();showItems(reviewRow);};
$('options-cancel').onclick=()=>$('options-dialog').close();
let optionsBackdrop=false;
$('options-dialog').addEventListener('pointerdown',event=>{const r=$('options-dialog').getBoundingClientRect();optionsBackdrop=event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;});
$('options-dialog').addEventListener('click',event=>{const r=$('options-dialog').getBoundingClientRect();if(optionsBackdrop&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))$('options-dialog').close();optionsBackdrop=false;});

function review(row){
  reviewRow=row;$('review-party').value=row.vendor;$('review-date').value=row.date;
  $('review-amount').value=row.amount;$('review-kind').value=({'Personal Receipt':'Personal - Credit Card','Business Receipt':'Business - Credit Card','Personal Credit Card':'Personal - Credit Card',Receipt:'Personal - Credit Card',Invoice:'Document Uncategorized',Statement:'Document Uncategorized','Tax document':'Tax Document','Medical document':'Medical Document',Document:'Document Uncategorized'}[row.kind]||row.kind);$('review-reasons').textContent=row.reasons||'';
  setReviewEditing(false);$('review-dialog').showModal();$('review-title').focus({preventScroll:true});
}
function setReviewEditing(editing){
  for(const id of ['review-party','review-date','review-amount'])$(id).readOnly=!editing;
  $('review-kind').disabled=!editing;$('review-edit').hidden=editing;
}
$('review-edit').onclick=()=>setReviewEditing(true);
let reviewBackdrop=false;
$('review-dialog').addEventListener('pointerdown',event=>{const r=$('review-dialog').getBoundingClientRect();reviewBackdrop=event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;});
$('review-dialog').addEventListener('click',event=>{const r=$('review-dialog').getBoundingClientRect();if(reviewBackdrop&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))$('review-dialog').close();reviewBackdrop=false;});
async function reviewAction(action){
  const fields={party:$('review-party').value.trim(),doc_date:$('review-date').value,
    amount:$('review-amount').value.replace(/[$,]/g,'').trim(),kind:$('review-kind').value};
  if(action==='file'&&fields.amount){
    if(!/^-?\d+(\.\d{1,2})?$/.test(fields.amount)){say('Enter a valid receipt amount.');return;}
    fields.amount=Number(fields.amount).toFixed(2);
  }
  try{
    await store.action(reviewRow,action,fields);$('review-dialog').close();
    say('Change saved here. It will apply when the Surface is available.');await sync();
  }catch(e){say(e.message||'The change could not be saved. Please try again.');}
}
$('review-form').onsubmit=event=>{event.preventDefault();reviewAction('file');};
$('review-open').onclick=()=>openDocument(reviewRow);
$('review-close').onclick=()=>$('review-dialog').close();
$('review-trash').onclick=()=>{if(confirm('Move this document to Trash? It can be restored on the Surface.'))reviewAction('trash');};

async function capture(event){
  const files=[...event.target.files];let count=0;
  try{
    const target=await store.get('collection');
    for(let file of files){
      say('Saving your receipt on this device…');
      const original=file;
      if(/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)||event.target.id==='camera'){
        file=await cropReceipt(file,store,target);if(file)count++;continue;
      }
      await store.save(file,target,file!==original?original:null);count++;

    }
    say(`Saved ${count} receipt${count===1?'':'s'} on this device. Delivery is automatic while PaperDrop is open.`);
    await navigator.storage?.persist?.();await render();await sync();
  }catch(e){say(`Saved ${count}. ${e.name==='QuotaExceededError'?'This device is out of storage. The remaining receipt was not saved.':e.message||'The next receipt could not be saved. Please try again.'}`);await render();}
  finally{event.target.value='';}
}

async function sync(){
  if(busy||!drive)return;busy=true;
  try{
      if(!drive.config.clientId){showConnection('error','OneDrive setup is not finished. Receipts stay on this device.');return;}
      if(!navigator.onLine){showConnection('offline');return;}
      if(!drive.auth?.getActiveAccount()){signInNeeded=true;showConnection(await store.get('collection')?'signin':'setup');return;}
      drive.onProgress=text=>{showConnection('uploading',text);say(text);};
      const run=()=>deliver(store,drive);
    const result=navigator.locks?await navigator.locks.request('paperdrop-delivery',{ifAvailable:true},lock=>lock?run():null):await run();
    if(!result)return;
    const waiting=(await store.list()).filter(r=>r.state==='saved').length;
      signInNeeded=false;
      showConnection(result.waiting?'folder':waiting?'pending':result.catalogUnavailable?'stale':'connected');
    say(result.waiting?'Saved on this device only. Tap Connect to enable OneDrive delivery.':waiting?'Receipts are saved on this device only and have not uploaded. Keep PaperDrop open to retry delivery.':result.catalogUnavailable?'The shared collection could not be refreshed. Uploaded receipts are in OneDrive; this list may be out of date.':'OneDrive delivery is up to date. The Surface processes uploaded receipts when it is available.');
    const actions=await store.actions();
    const attention=actions.find(a=>a.state==='attention');
    if(attention)say(attention.message);
    else if(actions.some(a=>['saved','submitted'].includes(a.state)))say('Your review changes are saved and waiting for the Surface.');
    await render();
  }catch(e){signInNeeded=!!e.authRequired;showConnection(signInNeeded?'signin':e.receiptReadError?'localfile':'error',!signInNeeded&&(e.deliveryError||e.receiptReadError)?e.message:'');say(e.authRequired?'Sign in is required to resume uploads.':'Delivery has not completed. See the notice above.');}
  finally{busy=false;await render();}
}

async function showFolders(){
  const current=folderStack.at(-1)||null;
  $('folder-current').textContent=current?.name||'OneDrive';$('folder-use').disabled=!current;
  $('folder-back').disabled=!folderStack.length;$('folders').replaceChildren();
  const folders=await drive.folders(current);
  for(const folder of folders){const button=document.createElement('button');button.textContent='▸ '+folder.name;
    button.onclick=async()=>{folderStack.push(folder);try{await showFolders();}catch(e){say(e.message);}};$('folders').append(button);}
  if(!folders.length)$('folders').textContent='No subfolders. Use this folder if it is your shared collection.';
}
$('connect').onclick=async()=>{
  try{
      if(!drive){showConnection('error','PaperDrop is still opening. Close and reopen it if this persists.');return;}
      if(signInNeeded){await drive.signIn();return;}
    await drive.token();
    if(await store.get('collection')){say('OneDrive is connected to your shared collection.');await sync();return;}
    folderStack=[];$('folder-dialog').showModal();await showFolders();
    }catch(e){if(e.authRequired){signInNeeded=true;showConnection('signin');await drive.signIn().catch(e=>say(e.message));}else {showConnection('error',e.deliveryError?e.message:'The OneDrive connection could not be completed. Your saved receipts remain on this device.');say(e.message);}}
};
$('folder-back').onclick=async()=>{folderStack.pop();await showFolders().catch(e=>say(e.message));};
$('folder-cancel').onclick=()=>$('folder-dialog').close();
$('folder-use').onclick=async()=>{
  const target=folderStack.at(-1);if(!target)return;
  await store.set('collection',target);$('folder-dialog').close();say('Collection connected.');await sync();
};
$('resume-receipt').onclick=async()=>{try{await cropReceipt(null,store);await render();await sync();}catch(e){say(e.message);await render();}};
$('take-photo').onclick=async()=>{
  try{const target=await store.get('collection');const mode=await captureReceiptCamera(store,target);
    if(mode==='save'||mode==='review')await cropReceipt(null,store,target,{autoSave:mode==='save'});
    await render();await sync();
  }catch(e){say('Your saved sections are kept. '+e.message);await render();}
};
$('camera').onchange=capture;$('files').onchange=capture;$('refresh').onclick=sync;$('search').oninput=()=>render();
document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{
  filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b===button));render();
});
window.addEventListener('online',sync);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')sync();});
async function start(){
  // Updates must not wait for Microsoft authentication or OneDrive delivery.
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{});
  }
  try{
    await render();
    const config=await fetch('./config.json').then(r=>r.json());drive=new OneDrive(config);await drive.init();
    $('setup-note').textContent=!config.clientId?'Installation in progress: the Microsoft account connection still needs to be registered. Capture works locally; OneDrive delivery is not enabled yet.':'Microsoft permission covers files you can access in OneDrive, including shared files. PaperDrop uses the collection folder you select.';
    await sync();setInterval(sync,30000);
    }catch(e){signInNeeded=!!e.authRequired;showConnection(signInNeeded?'signin':'error',signInNeeded?'Microsoft did not complete sign-in. Your receipt folder and saved receipts are still here. Tap Sign in to OneDrive.':'PaperDrop could not finish connecting. Your saved receipts have not been removed.');say('PaperDrop could not finish opening. Your saved receipts have not been removed. '+e.message);}
}
start();
