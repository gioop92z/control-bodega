// VANTIS: enriquecimiento PUBLICO, independiente del inventario y del flujo del lector.
const ENDPOINT='https://uphnzyembyrouvqohwys.supabase.co/functions/v1/liverpool-catalogo';
const KEY='vantis.catalogo-publico.v4';
const MAX=160;
const inflight=new Map();
const valid=code=>/^[a-zA-Z0-9]{6,20}$/.test(String(code||''));
export const publicSearchUrl=code=>'https://www.liverpool.com.mx/tienda?s='+encodeURIComponent(String(code||''));
function readCache(){
  try {
    const items=JSON.parse(localStorage.getItem(KEY)||'{}');
    return items&&typeof items==='object'&&!Array.isArray(items)?items:{};
  }catch{return {};}
}
function cached(code){
  const item=readCache()[code];
  return item&&item.expires>Date.now()&&item.value?.code===code?item.value:null;
}
function save(code,value){
  try{
    const items=readCache();
    items[code]={value,expires:Date.now()+(value.status==='verified'?7*864e5:value.status==='candidate'?864e5:300e3)};
    const pairs=Object.entries(items).filter(([,r])=>r?.expires>Date.now()).sort((a,b)=>b[1].expires-a[1].expires).slice(0,MAX);
    localStorage.setItem(KEY,JSON.stringify(Object.fromEntries(pairs)));
  }catch{/* Cuota llena o almacenamiento privado: la búsqueda sigue funcionando. */}
}
function imageAllowed(value){
  try{
    const u=new URL(value);
    return u.protocol==='https:'&&(u.hostname==='liverpool.com.mx'||u.hostname.endsWith('.liverpool.com.mx')||u.hostname==='gcp-na-images.contentstack.com'||u.hostname==='images.contentstack.io');
  }catch{return false;}
}
async function one(code){
  const local=cached(code);
  if(local)return {...local,cache:'dispositivo'};
  if(navigator.onLine===false)return {status:'offline',code};
  if(inflight.has(code))return inflight.get(code);
  const job=(async()=>{
    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),8500);
    try{
      const response=await fetch(ENDPOINT+'?code='+encodeURIComponent(code),{method:'GET',mode:'cors',
        signal:ctl.signal,cache:'no-store',headers:{Accept:'application/json'}});
      if(!response.ok)throw Error('Catalogo no disponible: '+response.status);
      const data=await response.json();
      if(!data||data.code!==code)throw Error('Respuesta de codigo inconsistente');
      if(data.status==='verified'||data.status==='candidate'){
        if(!imageAllowed(data.imageUrl))throw Error('Imagen externa no validada');
        const link=new URL(data.productUrl);
        if(link.protocol!=='https:'||link.hostname!=='www.liverpool.com.mx'||!link.pathname.startsWith('/tienda/pdp/'))
          throw Error('Enlace externo no validado');
        const result={status:data.status,code,title:String(data.title||'').slice(0,180),
          brand:String(data.brand||'').slice(0,70),color:String(data.color||'').slice(0,45),
          imageUrl:data.imageUrl,productUrl:link.href,liverpoolCode:data.liverpoolCode||'',
          source:'liverpool_web_public',sizeVerified:false};
        save(code,result);return result;
      }
      if(data.status==='not_found'){const res={status:'not_found',code};save(code,res);return res;}
      return {status:'unavailable',code};
    }catch{return {status:'unavailable',code};}
    finally{clearTimeout(timer);}
  })();
  inflight.set(code,job);
  try{return await job;}finally{inflight.delete(code);}
}
export async function lookupPublicCatalog(codes){
  const unique=[...new Set(codes.map(x=>String(x||'').trim()).filter(valid))].slice(0,2);
  if(!unique.length)return {status:'invalid_code'};
  for(const code of unique){const item=cached(code);if(item?.status==='verified')return {...item,cache:'dispositivo'};}
  // Dos identificadores como máximo; son metadatos, no inventario.
  const results=await Promise.all(unique.map(one));
  return results.find(x=>x.status==='verified')||results.find(x=>x.status==='candidate')||
    (results.some(x=>x.status==='unavailable')?{status:'unavailable',code:unique[0]}:
      results.some(x=>x.status==='offline')?{status:'offline',code:unique[0]}:
      {status:'not_found',code:unique[0]});
}

export function parseLiverpoolFamilyUrl(value){
  try{
    const trimmed=String(value||'').trim();
    if(/^\d{8,14}$/.test(trimmed))return null; // Se requiere vínculo oficial para localizar el slug exacto.
    const u=new URL(trimmed);
    if(u.protocol!=='https:'||u.hostname!=='www.liverpool.com.mx')return null;
    if(!/^\/tienda\/pdp\/[A-Za-z0-9%_./-]+\/\d{8,14}$/.test(u.pathname))return null;
    return {url:u.origin+u.pathname,familyCode:u.pathname.match(/\/(\d{8,14})$/)[1]};
  }catch{return null;}
}
export async function lookupLiverpoolFamily(code,rawUrl){
  const link=parseLiverpoolFamilyUrl(rawUrl);
  if(!valid(code)||!link)return {status:'invalid_family_link'};
  if(navigator.onLine===false)return {status:'offline'};
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8500);
  try{
    const res=await fetch(ENDPOINT+'?code='+encodeURIComponent(code)+'&familyUrl='+encodeURIComponent(link.url),{
      method:'GET',signal:ctl.signal,cache:'no-store',headers:{Accept:'application/json'}});
    if(!res.ok)return {status:'unavailable'};
    const data=await res.json();
    const p=data?.productUrl&&parseLiverpoolFamilyUrl(data.productUrl);
    if(data.status!=='family'||data.code!==code||p?.familyCode!==link.familyCode)
      return {status:'unavailable'};
    if(data.imageUrl&&!imageAllowed(data.imageUrl))return {status:'unavailable'};
    return {status:'family',code,liverpoolCode:link.familyCode,
      title:String(data.title||'').slice(0,180),brand:String(data.brand||'').slice(0,70),
      color:String(data.color||'').slice(0,50),imageUrl:data.imageUrl||'',
      productUrl:p.url,source:'liverpool_web_public',sizeVerified:false};
  }catch{return {status:'unavailable'};}
  finally{clearTimeout(timer);}
}
