// VANTIS Corridas · relaciones visuales, sin alterar cantidades ni ubicaciones.
// Separa una coincidencia de modelo documentada de una sugerencia basada en foto.
const NS='vantis.corridas.v1.';
const CAP=1800,AGE=45*86400_000;
const skuOK=s=>/^[A-Za-z0-9]{6,20}$/.test(String(s||''));
const safe=s=>String(s||'').trim();
const normalized=s=>safe(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
export function modelName(name){
 return normalized(name).replace(/\b(?:TALLA|NUMERO|NO)\s*\d{1,2}(?:[.,]\d)?\b/g,'')
 .replace(/\b\d{1,2}(?:[.,]\d)?\s*(?:CM|CENTIMETROS)\b/g,'')
 .replace(/\s+/g,' ').trim();
}
export const unknownName=s=>!safe(s)||/^(PRODUCTO NUEVO|PRODUCTO SIN|DESCONOCIDO|SKU\b|SIN DESCRIPCION)/.test(normalized(s));
function validImage(url){try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='liverpool.com.mx'||u.hostname.endsWith('.liverpool.com.mx'));}catch{return false;}}
function key(dept){return NS+safe(dept);}
function read(dept){
 try{const entries=JSON.parse(localStorage.getItem(key(dept))||'{}');return entries&&typeof entries==='object'&&!Array.isArray(entries)?entries:{};}catch{return {};}
}
function write(dept,entries){
 try{
  const sorted=Object.entries(entries).filter(([sku,e])=>skuOK(sku)&&e?.seen&&Date.now()-e.seen<AGE)
    .sort((a,b)=>b[1].seen-a[1].seen).slice(0,CAP);
  localStorage.setItem(key(dept),JSON.stringify(Object.fromEntries(sorted)));
  return true;
 }catch{return false;}
}
export function imageFingerprint(url){
 if(!validImage(url))return '';
 try{
  const u=new URL(url);
  const filename=u.pathname.split('/').pop()||'';
  // Sólo igualdad de archivo, NO adivinar familias por prefijos numéricos.
  const base=filename.toLowerCase().replace(/_(?:1p|2p|3p|sm|lg|xl)(?=\.)/,'');
  return /^[a-z0-9_-]{6,120}\.(?:jpg|jpeg|png|webp)$/.test(base)?base:'';
 }catch{return '';}
}
function takeProduct(p){
 return {sku:safe(p?.sku),upc:safe(p?.upc),talla:safe(p?.talla),color:safe(p?.color),
  marca:safe(p?.marca),descripcion:safe(p?.descripcion)};
}
export function recordRunProduct(dept,product,source=null){
 if(!dept||!skuOK(product?.sku))return null;
 const items=read(dept),sku=safe(product.sku),previous=items[sku]||{};
 const p=takeProduct(product);
 const evidence=source&&['verified','candidate','family_reference','operator_confirmed','family'].includes(source.status)&&
   /^\d{8,14}$/.test(String(source.liverpoolCode||''))&&validImage(source.imageUrl)&&
   String(source.productUrl||'').startsWith('https://www.liverpool.com.mx/tienda/pdp/')?source:null;
 const photoOnly=source?.status==='preview'&&validImage(source.imageUrl)?source:null;
 const rank={'verified':4,'operator_confirmed':4,'family_reference':3,'family':3,'candidate':2,'image_preview':1};
 const existingRank=rank[previous.sourceStatus]||0,newRank=rank[evidence?.status||(photoOnly?'image_preview':'')]||0;
 // No reemplazar una familia fuerte por una sugerencia débil de otra familia.
 const useSource=evidence&&newRank>=existingRank;
 const item={...previous,...Object.fromEntries(Object.entries(p).filter(([,v])=>v)),seen:Date.now()};
 if(useSource){
  item.familyCode=String(evidence.liverpoolCode);item.imageUrl=evidence.imageUrl;
  item.productUrl=evidence.productUrl;item.sourceStatus=evidence.status;
  item.modelTitle=safe(evidence.title);item.sourceBrand=safe(evidence.brand);item.sourceColor=safe(evidence.color);
 }else if(photoOnly&&existingRank<2){
  // Una foto aislada es pista débil; nunca confirma la familia ni la talla.
  item.imageUrl=photoOnly.imageUrl;item.sourceStatus='image_preview';
 }
 items[sku]=item;write(dept,items);return item;
}
export function storedRun(dept,sku){return read(dept)[safe(sku)]||null;}

/**
 * Reutiliza una ficha genérica ya documentada en este dispositivo.
 * Nunca equipara el SKU de talla al código padre ni afirma talla verificada.
 * Ante dos familias posibles se abstiene para evitar fotos incorrectas.
 */
export function knownFamilyCandidate(dept,product){
 const sku=safe(product?.sku),name=modelName(product?.descripcion);
 if(!skuOK(sku)||!name||unknownName(name))return null;
 const brand=normalized(product?.marca),color=normalized(product?.color);
 const matches=Object.values(read(dept)).filter(row=>{
   if(!row?.familyCode||!row?.imageUrl||!row?.productUrl||row.sku===sku)return false;
   if(!['verified','operator_confirmed','family_reference','family'].includes(row.sourceStatus))return false;
   if(modelName(row.descripcion)!==name)return false;
   const rowBrand=normalized(row.marca||row.sourceBrand);
   const rowColor=normalized(row.color||row.sourceColor);
   return !(brand&&rowBrand&&brand!==rowBrand)&&!(color&&rowColor&&color!==rowColor);
 });
 const families=new Map();
 for(const row of matches) {
   const id=row.familyCode;
   if(!families.has(id))families.set(id,row);
 }
 if(families.size!==1)return null;
 const row=[...families.values()][0];
 return {status:'candidate',code:sku,liverpoolCode:row.familyCode,
   imageUrl:row.imageUrl,productUrl:row.productUrl,
   title:row.modelTitle||row.descripcion,brand:row.sourceBrand||row.marca,
   color:row.sourceColor||row.color,
   source:'local_family_reference',reason:'documented_sibling',sizeVerified:false};
}

export function runMembers(dept,sku){
 const all=read(dept),ref=all[safe(sku)];
 if(!ref)return {confirmed:[],probable:[],ref:null};
 const confirmed=[],probable=[];
 for(const [otherSku,other] of Object.entries(all)){
  if(otherSku===safe(sku))continue;
  // No mezclar colores conocidos distintos, salvo familia idéntica que permita
  // mostrar diferencias de color con aviso (no declararla misma corrida).
  const colA=normalized(ref.color||ref.sourceColor),colB=normalized(other.color||other.sourceColor);
  if(colA&&colB&&colA!==colB)continue;
  const brandA=normalized(ref.marca||ref.sourceBrand),brandB=normalized(other.marca||other.sourceBrand);
  if(brandA&&brandB&&brandA!==brandB)continue;
  const sameFamily=ref.familyCode&&ref.familyCode===other.familyCode;
  const sameImage=imageFingerprint(ref.imageUrl)&&imageFingerprint(ref.imageUrl)===imageFingerprint(other.imageUrl);
  if(sameFamily){
   const trusted=['verified','operator_confirmed','family_reference','family'];
   (trusted.includes(ref.sourceStatus)&&trusted.includes(other.sourceStatus)?confirmed:probable).push({...other,reason:'family'});
  } else if(sameImage){
   // Imagen idéntica sin marca/color contradictorios = solo propuesta revisable.
   probable.push({...other,reason:'shared-image'});
  }
 }
 const ordered=a=>a.sort((x,y)=>(Number.parseFloat(x.talla)||999)-(Number.parseFloat(y.talla)||999)||x.sku.localeCompare(y.sku));
 return {ref,confirmed:ordered(confirmed),probable:ordered(probable)};
}
export async function fetchRunInventory(sb,dept,skus){
 const codes=[...new Set(skus.filter(skuOK))].slice(0,250);
 if(!codes.length)return {rows:[],error:null};
 const rows=[];
 try{
  for(let i=0;i<codes.length;i+=60){
   const {data,error}=await sb.from('productos').select('sku,upc,descripcion,marca,talla,color,stock')
    .eq('departamento_id',dept).eq('activo',true).in('sku',codes.slice(i,i+60));
   if(error)throw error;rows.push(...data||[]);
  }
  return {rows,error:null};
 }catch(error){return {rows:[],error};}
}
export async function nearbyRunSuggestions(sb,dept,product,{limit=40}={}){
 const sku=safe(product?.sku);
 if(!/^\d{8,14}$/.test(sku))return [];
 const name=modelName(product.descripcion);
 if(unknownName(name)||name.length<10)return [];
 const prefix=sku.slice(0,Math.min(7,sku.length-1));
 try{
  const {data,error}=await sb.from('productos')
   .select('sku,upc,descripcion,marca,talla,color,stock')
   .eq('departamento_id',dept).eq('activo',true).ilike('sku',prefix+'%').limit(limit);
  if(error)return [];
  return (data||[]).filter(p=>p.sku!==sku&&modelName(p.descripcion)===name&&
   (!product.color||!p.color||normalized(product.color)===normalized(p.color))&&
   (!product.marca||!p.marca||normalized(product.marca)===normalized(p.marca)));
 }catch{return [];}
}
