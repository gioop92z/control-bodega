// Referencias de productos que el operador mostró comparando VANTIS y Liverpool.
// El ID del producto de Liverpool NO se presupone idéntico al SKU de inventario.
const CANDIDATES=Object.freeze({
  '1180029415':Object.freeze({
    code:'1180029415',liverpoolCode:'1180029353',
    title:'Zapato Mary Jane Mila de piel para niño',
    brand:'ELEFANTE',color:'Negro',
    productUrl:'https://www.liverpool.com.mx/tienda/pdp/zapato-mary-jane-mila-de-piel-para-ni%C3%B1o/1180029353',
    imageUrl:'https://ss405.liverpool.com.mx/xl/1180029353.jpg',
    source:'liverpool_web_public',status:'candidate',confidence:'operator_review_required'
  }),
  // Relación de SKU de talla con ficha genérica mostrada por el operador.
  '1180031266':Object.freeze({
    code:'1180031266',liverpoolCode:'1180031226',
    title:'Zapato Mary Jane Mila de piel para niña',
    brand:'ELEFANTE',color:'Negro',
    productUrl:'https://www.liverpool.com.mx/tienda/pdp/zapato-mary-jane-elefante-mila-de-piel-para-ni%C3%B1a/1180031226',
    imageUrl:'https://ss405.liverpool.com.mx/xl/1180031226.jpg',
    source:'liverpool_web_public',status:'family_reference',
    confidence:'operator_documented_parent',sizeVerified:false
  })
});
const KEY='vantis.catalogo-relaciones-confirmadas.v1';
const safeCode=code=>/^\d{8,14}$/.test(String(code||''));
function read(){
  try{const result=JSON.parse(localStorage.getItem(KEY)||'{}');return result&&typeof result==='object'?result:{};}catch{return {};}
}
export function catalogCandidate(codes){
  const keys=[...new Set((codes||[]).map(x=>String(x||'').trim()))];
  for(const code of keys){
    if(!safeCode(code))continue;
    const saved=read()[code];
    if(saved&&saved.code===code&&safeCode(saved.liverpoolCode)&&String(saved.productUrl||'').startsWith('https://www.liverpool.com.mx/tienda/pdp/')){
      return {...saved,status:'operator_confirmed'};
    }
    if(CANDIDATES[code]&&!isRejectedCandidate(code))return {...CANDIDATES[code]};
  }
  return null;
}
export function confirmCatalogCandidate(code,candidate){
  if(!safeCode(code)||candidate?.code!==code||!safeCode(candidate.liverpoolCode)||!candidate.title||!candidate.imageUrl)return false;
  if(!String(candidate.productUrl||'').startsWith('https://www.liverpool.com.mx/tienda/pdp/'))return false;
  if(!/^https:\/\/([\w-]+\.)?liverpool\.com\.mx\//.test(candidate.imageUrl))return false;
  try{
    const items=read();
    items[code]={...candidate,status:'operator_confirmed',confirmedAt:new Date().toISOString()};
    const trimmed=Object.fromEntries(Object.entries(items).slice(-150));
    localStorage.setItem(KEY,JSON.stringify(trimmed));
    return true;
  }catch{return false;}
}
export function rejectCatalogCandidate(code){
  try{
    const items=read();
    // Evita eliminar evidencia original; ocultar solo la sugerencia local actual.
    const rejected=JSON.parse(localStorage.getItem(KEY+'.rechazados')||'{}');
    rejected[code]=true;
    localStorage.setItem(KEY+'.rechazados',JSON.stringify(rejected));
    delete items[code];localStorage.setItem(KEY,JSON.stringify(items));
  }catch{}
}
export function isRejectedCandidate(code){
  try{return !!JSON.parse(localStorage.getItem(KEY+'.rechazados')||'{}')[code];}catch{return false;}
}
