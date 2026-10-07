// Persist bytes, not browser-managed Blob/File handles, in IndexedDB.
export async function readBytes(blob){
  let timer;
  try{
    const bytes=await Promise.race([blob.arrayBuffer(),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('Reading saved file timed out.')),15000);
    })]);
    if(!bytes.byteLength||bytes.byteLength!==blob.size)throw new Error('Saved file is empty or incomplete.');
    return bytes;
  }finally{clearTimeout(timer);}
}
export async function packFiles(value,strict=true){
  if(value instanceof Blob){
    try{return {paperdropBinary:1,bytes:await readBytes(value),type:value.type,name:value.name,lastModified:value.lastModified};}
    catch(error){if(strict)throw error;return value;}
  }
  if(value instanceof ArrayBuffer||ArrayBuffer.isView(value)||value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return Promise.all(value.map(v=>packFiles(v,strict)));
  const result={};for(const [key,item] of Object.entries(value))result[key]=await packFiles(item,strict);return result;
}
export function unpackFiles(value){
  if(value?.paperdropBinary===1&&value.bytes instanceof ArrayBuffer){
    return value.name!==undefined?new File([value.bytes],value.name,{type:value.type,lastModified:value.lastModified}):new Blob([value.bytes],{type:value.type});
  }
  if(value instanceof Blob||value instanceof ArrayBuffer||ArrayBuffer.isView(value)||value===null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(unpackFiles);
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,unpackFiles(item)]));
}
