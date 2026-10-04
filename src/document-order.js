function dateNumber(year,month,day){
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?year*10000+month*100+day:0;
}
export function receiptDate(row){
  const title=row.filename||row.name||'',prefix=title.match(/^(\d{2})(\d{2})(\d{2})(?=\s|[._-]|$)/);
  if(prefix){const yy=Number(prefix[3]),value=dateNumber((yy<70?2000:1900)+yy,Number(prefix[1]),Number(prefix[2]));if(value)return value;}
  const iso=(row.date||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso?dateNumber(Number(iso[1]),Number(iso[2]),Number(iso[3])):0;
}
export function newestReceiptFirst(a,b){
  return receiptDate(b)-receiptDate(a)||(a.filename||a.name||'').localeCompare(b.filename||b.name||'')||String(a.id).localeCompare(String(b.id));
}
