import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// VANTIS: catalogo web publico solamente. No lee ni modifica existencias.
const SOURCE='liverpool_web_public';
const ORIGINS=new Set(['https://gioop92z.github.io','http://localhost:3000','http://127.0.0.1:3000']);
const requests=new Map();
const safeCode = code => /^[a-zA-Z0-9]{6,20}$/.test(code);
const searchUrl = code => 'https://www.liverpool.com.mx/tienda?s='+encodeURIComponent(code);
const decode = value => String(value||'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\\\//g,'/');
function canonical(raw) {
  try {const u=new URL(decode(raw),'https://www.liverpool.com.mx');
    if(u.protocol!=='https:'||u.hostname!=='www.liverpool.com.mx'||!/^\/tienda\/pdp\//.test(u.pathname))return '';
    return u.origin+u.pathname;
  }catch{return '';}
}
function secureImage(raw){
  try {const u=new URL(decode(raw),'https://www.liverpool.com.mx');
    if(u.protocol!=='https:')return '';
    const host=u.hostname;
    if(host==='liverpool.com.mx'||host.endsWith('.liverpool.com.mx')||host==='gcp-na-images.contentstack.com'||host==='images.contentstack.io')return u.href;
    return '';
  }catch{return '';}
}
function meta(html,key) {
  const tags=html.match(/<meta\b[^>]*>/gi)||[];
  for(const tag of tags) {
    if(!new RegExp('(?:property|name)\\s*=\\s*["\\\']'+key+'["\\\']','i').test(tag))continue;
    const match=tag.match(/content\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if(match)return decode(match[1]||match[2]);
  }
  return '';
}
function structured(html) {
  const blocks=[...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const found=[];
  function collect(v){if(Array.isArray(v)){v.forEach(collect);return;}if(!v||typeof v!=='object')return;
    const t=v['@type'];if(t==='Product'||(Array.isArray(t)&&t.includes('Product')))found.push(v);
    if(v['@graph'])collect(v['@graph']);
  }
  for(const item of blocks.slice(0,12)){try{collect(JSON.parse(item[1]));}catch{}}
  return found;
}
function productFrom(html,url,code){
  const page=canonical(url);
  if(!page)return null;
  const id=page.match(/\/(\d{8,14})$/)?.[1]||'';
  const products=structured(html);
  const exact=products.find(p=>[p.sku,p.productID,p.mpn,p.gtin,p.gtin12,p.gtin13,p.gtin14].some(v=>String(v||'').trim()===code));
  // Buscar un SKU hijo explícito dentro de la ficha del producto padre.
  // La coincidencia es SÓLO una sugerencia: no equivale a talla verificada.
  const variantFields=html.match(/"(?:skuId|skuID|skuid|sku_id|variantId|childSku|sku)"\s*:\s*"?\d{8,14}/gi)||[];
  const variantMatched=id!==code&&!exact&&variantFields.some(part=>part.match(/\d{8,14}$/)?.[0]===code);
  if(id!==code&&!exact&&!variantMatched)return null;
  const p=exact||products[0]||{};
  const brand=typeof p.brand==='string'?p.brand:p.brand?.name||'';
  const imageCandidate=Array.isArray(p.image)?p.image[0]:(typeof p.image==='object'?p.image?.url:p.image);
  const galleryImages=[...html.matchAll(/https?:\/\/(?:ss|sp)\d+\.liverpool\.com\.mx\/(?:xl|lg|i)\/[^"'\s<>]+/gi)]
    .map(x=>x[0]).filter(url=>url.includes('/'+id+'.')||url.includes('/'+id+'_'));
  const image=secureImage(imageCandidate||meta(html,'og:image')||meta(html,'twitter:image')||galleryImages[0]);
  const heading=String(p.name||meta(html,'og:title')||meta(html,'twitter:title')||'').replace(/\s*[|·]\s*Liverpool.*$/i,'').trim();
  if(!heading||!image)return null; // Respuesta incompleta: no inventar coincidencia.
  return {status:variantMatched?'candidate':'verified',code,source:SOURCE,matchType:variantMatched?'variant_reference_in_page':id===code?'liverpool_product_id':'published_identifier',
    title:heading.slice(0,180),brand:String(brand).slice(0,70),color:String(p.color||'').slice(0,45),
    imageUrl:image,productUrl:page,liverpoolCode:id,sizeVerified:false};
}
async function lookup(code,signal){
  const r=await fetch(searchUrl(code),{method:'GET',redirect:'follow',signal,headers:{Accept:'text/html', 'User-Agent':'VANTIS-Catalogo/1.0 (public product metadata)'}});
  if(r.status===403||r.status===429||r.status>=500)throw Error('Proveedor no disponible');
  if(!r.ok||!(r.headers.get('content-type')||'').includes('text/html'))return null;
  const html=(await r.text()).slice(0,2000000);
  const direct=productFrom(html,r.url,code);if(direct)return direct;
  // Si la propia búsqueda de Liverpool redirige el SKU de talla a una ficha
  // genérica, reutilizarla como imagen de modelo (no como talla comprobada).
  const redirectedParent=canonical(r.url);
  if(redirectedParent&&redirectedParent.match(/\/(\d{8,14})$/)?.[1]!==code){
    const parentCode=redirectedParent.match(/\/(\d{8,14})$/)?.[1];
    const family=parentCode?productFrom(html,redirectedParent,parentCode):null;
    if(family)return {...family,status:'candidate',code,liverpoolCode:parentCode,
      matchType:'liverpool_search_redirect',sizeVerified:false};
  }
  const candidates=[];
  const raw=decode(html).replace(/\\u002F/gi,'/');
  const re=/(?:https?:\/\/www\.liverpool\.com\.mx)?\/tienda\/pdp\/[a-zA-Z0-9%/_\-]+\/\d{8,14}/g;
  for(const m of raw.matchAll(re)){const url=canonical(m[0]);if(url&&!candidates.includes(url))candidates.push(url);if(candidates.length>=24)break;}
  const exactUrl=candidates.find(url=>url.endsWith('/'+code));
  // Enlaces ?skuid=... significan que Liverpool ya relacionó esa talla con
  // el producto padre; no usamos coincidencia numérica aproximada.
  const withChildParam=[...raw.matchAll(/\/tienda\/pdp\/[a-zA-Z0-9%/_\-]+\/\d{8,14}\?[^"'<>\s]*/g)]
    .filter(m=>new RegExp('[?&]skuid='+code+'(?:[&#]|$)','i').test(m[0]))
    .map(m=>canonical(m[0])).filter(Boolean);
  const chosen=exactUrl?[exactUrl]:[...new Set([...withChildParam,...candidates])].slice(0,5);
  let variantCandidate=null;
  for(const url of chosen){
    const p=await fetch(url,{signal,headers:{Accept:'text/html'}});
    if(!p.ok||!(p.headers.get('content-type')||'').includes('text/html'))continue;
    const body=(await p.text()).slice(0,1400000);
    const item=productFrom(body,p.url,code);
    if(item?.status==='verified')return item;
    if(item?.status==='candidate'&&!variantCandidate)variantCandidate=item;
    if(!item&&withChildParam.includes(url)){
      const parentId=url.match(/\/(\d{8,14})$/)?.[1];
      const parent=parentId?productFrom(body,p.url,parentId):null;
      if(parent&&!variantCandidate)variantCandidate={...parent,status:'candidate',code,
        liverpoolCode:parentId,matchType:'published_skuid_param',sizeVerified:false};
    }
  }
  return variantCandidate;
}
function allowedFamilyUrl(raw){
  try {
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.hostname!=='www.liverpool.com.mx')return null;
    if(!/^\/tienda\/pdp\/[a-zA-Z0-9%_./-]+\/\d{8,14}$/.test(url.pathname))return null;
    const familyId=url.pathname.match(/\/(\d{8,14})$/)?.[1];
    if(!familyId)return null;
    url.search='';url.hash='';
    return {url:url.toString(),familyId};
  }catch{return null;}
}
async function lookupFamily(child,raw,signal){
  const target=allowedFamilyUrl(raw);
  if(!target)return {status:'invalid_family_link',code:child};
  const response=await fetch(target.url,{signal,redirect:'follow',headers:{Accept:'text/html'}});
  if(!response.ok||!(response.headers.get('content-type')||'').includes('text/html'))return {status:'unavailable',code:child};
  const page=canonical(response.url);
  if(!page||!page.endsWith('/'+target.familyId))return {status:'unavailable',code:child};
  const html=(await response.text()).slice(0,1800000);
  const parsed=productFrom(html,page,target.familyId);
  if(parsed)return {...parsed,status:'family',code:child,liverpoolCode:target.familyId,
    matchType:'operator_linked_parent',sizeVerified:false};
  // En páginas hidratadas la galería puede faltar del HTML inicial.
  // Nunca inventamos marca ni descripción: si la ficha pública no tiene título
  // verificable se devuelve unavailable; el cliente podrá probar la foto CDN.
  const title=meta(html,'og:title')||meta(html,'twitter:title');
  if(!title)return {status:'unavailable',code:child};
  return {status:'family',code:child,liverpoolCode:target.familyId,
    title:title.replace(/\s*[|·]\s*Liverpool.*$/i,'').slice(0,180),
    brand:'',color:'',imageUrl:'',productUrl:page,
    source:SOURCE,matchType:'operator_linked_parent',sizeVerified:false};
}
function reply(payload,status=200,origin=''){
  return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8',
    'access-control-allow-origin':origin||'https://gioop92z.github.io','vary':'Origin','cache-control':'no-store'}});
}
Deno.serve(async req=>{
  const origin=req.headers.get('origin')||'';
  if(origin&&!ORIGINS.has(origin))return reply({status:'forbidden'},403);
  if(req.method==='OPTIONS')return new Response('',{status:204,headers:{'access-control-allow-origin':origin||'https://gioop92z.github.io','access-control-allow-methods':'GET,OPTIONS','access-control-allow-headers':'content-type,apikey,authorization','access-control-max-age':'3600'}});
  if(req.method!=='GET')return reply({status:'method_not_allowed'},405,origin);
  const code=(new URL(req.url)).searchParams.get('code')?.trim()||'';
  if(!safeCode(code))return reply({status:'invalid_code'},400,origin);
  const ip=(req.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim().slice(0,70);
  const now=Date.now(), key=ip+':'+Math.floor(now/60000);
  if(requests.size>200)for(const [k,v] of requests)if(v.at<now-120000)requests.delete(k);
  const counter=requests.get(key)||{n:0,at:now};counter.n++;requests.set(key,counter);
  if(counter.n>12)return reply({status:'rate_limited',searchUrl:searchUrl(code)},429,origin);
  const familyUrl=new URL(req.url).searchParams.get('familyUrl')||'';
  if(familyUrl){
    // El vínculo es explícito y está limitado a PDP públicas de Liverpool.
    const ctrl=new AbortController();
    const deadline=setTimeout(()=>ctrl.abort(),7500);
    try {
      const result=await lookupFamily(code,familyUrl,ctrl.signal);
      return reply(result,200,origin);
    }catch{return reply({status:'unavailable',code},200,origin);}
    finally{clearTimeout(deadline);}
  }
  const fallback={status:'not_found',code,source:SOURCE,searchUrl:searchUrl(code)};
  const sb=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',
    {auth:{autoRefreshToken:false,persistSession:false}});
  try{
    const cached=await sb.from('vantis_catalogo_externo_cache').select('*').eq('codigo',code).gt('vigente_hasta',new Date().toISOString()).maybeSingle();
    if(!cached.error&&cached.data){
      const c=cached.data;
      // No confiar indefinidamente en negativos guardados por el buscador anterior.
      // Los códigos de variante necesitan una nueva comprobación.
      if(c.estado==='verified')return reply({status:'verified',code,title:c.titulo,brand:c.marca,color:c.color,
        imageUrl:c.imagen_url,productUrl:c.producto_url,liverpoolCode:c.codigo_liverpool,source:SOURCE,cached:true,
        sizeVerified:false},200,origin);
    }
    const controller=new AbortController();
    const deadline=setTimeout(()=>controller.abort(),7500);
    let result=null;
    try{result=await lookup(code,controller.signal);}finally{clearTimeout(deadline);}
    const ttl=result?.status==='verified'?7*86400:600;
    const persist={codigo:code,estado:result?'verified':'not_found',titulo:result?.title||null,
      marca:result?.brand||null,color:result?.color||null,imagen_url:result?.imageUrl||null,
      producto_url:result?.productUrl||null,codigo_liverpool:result?.liverpoolCode||null,
      origen:SOURCE,consultado_en:new Date().toISOString(),vigente_hasta:new Date(Date.now()+ttl*1000).toISOString()};
    // El caché persistente es opcional: una caída de la tabla no bloquea la consulta.
    if(result?.status==='verified')await sb.from('vantis_catalogo_externo_cache').upsert(persist,{onConflict:'codigo'});
    return reply(result||fallback,200,origin);
  }catch(error){
    console.warn('VANTIS public catalog source unavailable:',String(error?.message||error).slice(0,160));
    return reply({status:'unavailable',code,source:SOURCE,searchUrl:searchUrl(code)},200,origin);
  }
});
