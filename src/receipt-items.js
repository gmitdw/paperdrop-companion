const $=id=>document.getElementById(id);
export function installItemReview({store,sync,say,openDocument}){
  let row,fields=[],editing=false;
  function edit(value){editing=value;for(const input of $('item-rows').querySelectorAll('input,select'))input.disabled=!value;$('items-edit').hidden=value;$('items-add').hidden=!value;}
  function add(item){
    const card=document.createElement('section');card.className='receipt-item';
    const heading=document.createElement('h3');heading.textContent=`${item.position}. ${item.entry_type==='discount'?'Discount':'Item'}`;
    const status=document.createElement('p');status.className='item-status';status.textContent=item.status==='confirmed'?'Confirmed':item.status==='excluded'?'Excluded':item.status==='unreadable'?'Price unreadable — leave blank unless you can verify it':item.status==='ambiguous'?'Check this price against the receipt':'Not yet confirmed';
    card.append(heading,status);const inputs={};
    function input(key,label,value,parent=card,type='text'){
      const wrap=document.createElement('label');wrap.textContent=label;const el=document.createElement('input');el.type=type;if(type!=='checkbox')el.value=value??'';else el.checked=!!value;
      if(['quantity','unit_price','line_amount','related_position'].includes(key)){el.inputMode='decimal';el.autocomplete='off';}
      wrap.append(el);parent.append(wrap);inputs[key]=el;return el;
    }
    input('description','Description',item.description).maxLength=500;
    input('line_amount','Line amount ($)',item.line_amount).placeholder='Unknown';
    const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Quantity, unit price and discount details';detail.append(summary);card.append(detail);
    input('product_code','Product code',item.product_code,detail).maxLength=80;
    input('quantity','Quantity (if known)',item.quantity,detail);
    input('unit_price','Unit price ($, if known)',item.unit_price,detail);
    const kindLabel=document.createElement('label');kindLabel.textContent='Line type';const kind=document.createElement('select');for(const [value,text] of [['item','Purchase / return'],['discount','Discount']]){const option=document.createElement('option');option.value=value;option.textContent=text;kind.append(option);}kind.value=item.entry_type;kindLabel.append(kind);detail.append(kindLabel);inputs.entry_type=kind;
    input('related_position','Discount applies to item number (leave blank if unknown)',item.related_position,detail);
    input('excluded','Exclude duplicate or non-item',item.status==='excluded',detail,'checkbox');
    fields.push({position:item.position,inputs});$('item-rows').append(card);
  }
  const show=selected=>{
    row=selected;fields=[];$('item-rows').replaceChildren();const data=row.receipt_items;
    $('items-note').textContent=data?data.notes.join(' '):'The Surface has not extracted items for this receipt yet.';
    for(const item of data?.items||[])add(item);
    $('items-confirm').disabled=!data;$('items-edit').disabled=!data;edit(false);
    $('items-dialog').showModal();$('items-title').focus({preventScroll:true});
  };
  $('items-edit').onclick=()=>edit(true);
  $('items-add').onclick=()=>{add({position:Math.max(0,...fields.map(f=>f.position))+1,description:'',entry_type:'item',status:'unreadable'});edit(true);};
  $('items-close').onclick=()=>$('items-dialog').close();
  $('items-open').onclick=()=>openDocument(row);
  $('items-confirm').onclick=async()=>{
    const items=fields.map(({position,inputs})=>Object.fromEntries([['position',position],...Object.entries(inputs).map(([key,el])=>[key,key==='excluded'?el.checked:key==='related_position'?(el.value.trim()?Number(el.value):null):el.value.trim()])]));
    try{
      if(items.some(i=>!i.description))throw new Error('Each item needs a description.');
      for(const i of items)for(const k of ['quantity','unit_price','line_amount'])if(i[k]&&!new RegExp('^-?\\d{1,9}(\\.\\d{1,'+(k==='quantity'?4:2)+'})?$').test(i[k]))throw new Error('Enter a valid number, or leave an unknown value blank.');
      await store.action(row,'items',{item_revision:row.receipt_items.revision,items});$('items-dialog').close();say('Item review saved. Unknown prices remain unknown.');await sync();
    }catch(e){$('items-note').textContent=e.message;}
  };
  let outside=false;$('items-dialog').onpointerdown=e=>{outside=e.target===$('items-dialog');};$('items-dialog').onclick=e=>{if(outside&&e.target===$('items-dialog')){const r=$('items-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('items-dialog').close();}outside=false;};
  return show;
}
