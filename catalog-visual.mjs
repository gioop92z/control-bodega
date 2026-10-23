// VANTIS catálogo visual: imagen pública por código, sin alterar inventario.
// Imagen preliminar ≠ ficha verificada. No se le adjudica talla/color sin confirmar.
const CDN_PATHS=['https://ss405.liverpool.com.mx/xl/','https://ss405.liverpool.com.mx/lg/','https://ss237.liverpool.com.mx/lg/','https://ss237.liverpool.com.mx/xl/','https://sp459.liverpool.com.mx/i/','https://ss550.liverpool.com.mx/xl/','https://ss550.liverpool.com.mx/lg/','https://ss251.liverpool.com.mx/xl/','https://ss251.liverpool.com.mx/lg/'];
const CACHE='vantis.imagenes-publicas.v1';
const inFlight=new Map();
function readCache(){
  try{return JSON.parse(localStorage.getItem(CACHE)||'{}')||{};}catch{return {};}
}
function save(key,url){
  try {
    const cache=readCache();cache[key]={url,until:Date.now()+3*86400000};
    const recent=Object.entries(cache).filter(([,v])=>v?.until>Date.now()).slice(-100);
    localStorage.setItem(CACHE,JSON.stringify(Object.fromEntries(recent)));
  }catch{}
}
function exactCodes(codes){
  return [...new Set(codes.map(c=>String(c||'').trim()).filter(c=>/^\d{8,11}$/.test(c)))].slice(0,2);
}
function probe(url,limit=3200){
  return new Promise(resolve=>{
    if(typeof Image!=='function'){resolve('');return;}
    const img=new Image();
    let settled=false;
    const done=success=>{
      if(settled)return;settled=true;clearTimeout(timer);
      img.onload=null;img.onerror=null;
      resolve(success?url:'');
    };
    const timer=setTimeout(()=>done(false),limit);
    img.onload=()=>done(img.naturalWidth>=160&&img.naturalHeight>=120);
    img.onerror=()=>done(false);
    img.decoding='async';
    img.src=url;
  });
}
export async function liverpoolPreview(codes){
  const values=exactCodes(codes);
  for(const code of values){
    const item=readCache()[code];
    if(item?.until>Date.now()&&item.url)return {status:'preview',code,imageUrl:item.url};
  }
  if(globalThis.navigator?.onLine===false)return null;
  for(const code of values){
    if(inFlight.has(code)){const v=await inFlight.get(code);if(v)return v;continue;}
    const task=(async()=>{
      // Únicamente CDN de Liverpool; no se adivinan fotos de marcas similares.
      const candidates=CDN_PATHS.flatMap(prefix=>[prefix+code+'.jpg',prefix+code+'_1p.jpg']);
      // Dos comprobaciones concurrentes. Incluye CDN de imágenes actual (sp459/i/) y legado (ss550).
      for(let i=0;i<candidates.length;i+=2){
        const results=await Promise.all(candidates.slice(i,i+2).map(url=>probe(url)));
        const url=results.find(Boolean);
        if(url){save(code,url);return {status:'preview',code,imageUrl:url};}
      }
      return null;
    })();
    inFlight.set(code,task);
    try{const value=await task;if(value)return value;}finally{inFlight.delete(code);}
  }
  return null;
}
