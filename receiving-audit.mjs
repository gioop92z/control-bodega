// Historial de lecturas por SKU. Consulta el diario local, sin crear existencias
// ni suponer que una lectura antigua fue manual o por cámara.
import {listMirroredReceiptRows} from './vantis-offline-idb-v5.mjs';

export const captureMethodLabel = method => ({
  camera:'Cámara',manual:'Manual',scanner:'Lector portátil',unknown:'Origen no registrado'
})[method] || 'Origen no registrado';

export async function listLocalSkuAudit(departmentId,userId,sku,{codes=[],limit=12,storage=globalThis.localStorage}={}){
  if(!departmentId||!userId||!sku)return [];
  const prefix='vantis.continuous.v1/'+userId+'/'+departmentId+'/';
  const aliases=new Set([sku,...codes].filter(Boolean).map(value=>String(value).trim()));
  const rows=new Map();
  function collect(key,row){
    if(!key?.startsWith(prefix)||!key.includes('/row/')||!row||row.kind!=='receive'||!row.id)return;
    if(!aliases.has(String(row.product?.sku||'').trim())&&!aliases.has(String(row.code||'').trim()))return;
    const scope=key.slice(prefix.length).split('/row/')[0];
    let name='';try{name=decodeURIComponent(scope);}catch{name=scope;}
    rows.set(row.id,{
      evento_id:row.id,capturada_en:row.capturedAt,codigo_leido:row.code,
      sku:row.product?.sku||'',operador:row.operator||name||'No identificado',
      metodo:['camera','manual','scanner'].includes(row.captureMethod)?row.captureMethod:'unknown',
      estado:row.status,marbete:row.location||'',sesion:row.sessionId||'',
      evidencia:row.evidenceStatus||'unknown'
    });
  }
  try{
    for(let i=0;i<storage.length;i++){
      const key=storage.key(i);
      if(!key?.startsWith(prefix)||!key.includes('/row/'))continue;
      try{collect(key,JSON.parse(storage.getItem(key)));}catch{}
    }
  }catch{}
  // Los registros antiguos compactados siguen en IndexedDB. La copia local
  // sincrónica prevalece si se encuentra la misma lectura en los dos diarios.
  try{
    const mirrored=await listMirroredReceiptRows(prefix);
    for(const entry of mirrored){
      if(!rows.has(entry.row?.id))collect(entry.key,entry.row);
    }
  }catch{}
  return [...rows.values()].sort((a,b)=>String(b.capturada_en||'').localeCompare(String(a.capturada_en||''))).slice(0,limit);
}
