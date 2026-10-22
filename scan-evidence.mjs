// Evidencias VANTIS: la lectura y el stock no esperan al envío de la foto.
// La captura se guarda localmente en IndexedDB hasta que la entrada quede confirmada.
export const EVIDENCE_BUCKET = 'vantis-evidencias';
const DB_NAME = 'vantis-evidencia-local-v1';
const STORE_NAME = 'fotogramas';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function evidencePath(departmentId, userId, eventId) {
  if (![departmentId,userId,eventId].every(value=>UUID.test(String(value||'')))) {
    throw Error('Identificador de evidencia no válido.');
  }
  return departmentId+'/'+userId+'/'+eventId+'.jpg';
}
function openEvidenceDb() {
  if (typeof indexedDB === 'undefined') return Promise.reject(Error('Este navegador no admite almacenamiento de imágenes offline.'));
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE_NAME))db.createObjectStore(STORE_NAME,{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('No se pudo abrir el historial local.'));
  });
}
let dbPromise;
function database() {return dbPromise ||=openEvidenceDb().catch(error=>{dbPromise=null;throw error;});}
async function transact(mode,method,arg) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,mode),request=tx.objectStore(STORE_NAME)[method](...(Array.isArray(arg)?arg:[arg]));
    tx.oncomplete=()=>resolve(request.result);
    tx.onabort=()=>reject(tx.error||request.error||Error('Error al conservar la evidencia.'));
    tx.onerror=()=>reject(tx.error||request.error||Error('Error al conservar la evidencia.'));
  });
}
const get=id=>transact('readonly','get',id);
const put=row=>transact('readwrite','put',row);
const remove=id=>transact('readwrite','delete',id);
const all=()=>transact('readonly','getAll',[]);
function errorText(error){return String(error?.message||error||'Sin detalle');}

export class ScanEvidence {
  constructor({sb,departmentId,userId,cloudEnabled=true,onIssue=()=>{}}) {
    this.sb=sb;this.departmentId=departmentId;this.userId=userId;this.onIssue=onIssue;this.cloudEnabled=cloudEnabled;
    this.uploading=false;this.retryScheduled=false;this.lastError='';
    this.online=()=>void this.sync();
    globalThis.addEventListener?.('online',this.online);
  }
  issue(message) {
    this.lastError=message;this.onIssue(message);
    console.warn('VANTIS · evidencia:',message);
  }
  async capture(eventId,code,frame,getRow=()=>null) {
    if(!UUID.test(String(eventId||'')))return;
    try {
      const blob=await Promise.resolve(frame);
      if(!(blob instanceof Blob)||blob.size===0)throw Error('Fotograma no disponible; coloca el código dentro de la guía de cámara.');
      if(blob.size>204800)throw Error('Fotograma demasiado grande; se conserva el movimiento, no la imagen.');
      const record={id:eventId,departmentId:this.departmentId,userId:this.userId,code:String(code).slice(0,120),
        blob,sku:'',capturedAt:new Date().toISOString()};
      await put(record);
      const row=getRow();
      if(row?.status==='confirmed') await this.confirm(row);
    } catch(error) {this.issue('La lectura se guardó sin imagen: '+errorText(error));}
  }
  async confirm(row) {
    if(row?.kind!=='receive'||row?.status!=='confirmed'||!row.product?.sku)return;
    try {
      const record=await get(row.id);
      if(!record||record.departmentId!==this.departmentId||record.userId!==this.userId)return;
      if(record.sku!==row.product.sku ||record.capturedAt!==row.capturedAt) {
        await put({...record,sku:row.product.sku,capturedAt:row.capturedAt});
      }
      void this.sync();
    } catch(error) {this.issue('No se pudo preparar evidencia: '+errorText(error));}
  }
  async sync() {
    if(!this.cloudEnabled||this.uploading||globalThis.navigator?.onLine===false)return;
    this.uploading=true;
    let more=false,failed=false;
    try {
      const pending=(await all()).filter(r=>r.departmentId===this.departmentId&&r.userId===this.userId&&r.sku);
      const batch=pending.slice(0,8);
      for(const record of batch) {
        if(globalThis.navigator?.onLine===false)break;
        const path=evidencePath(this.departmentId,this.userId,record.id);
        const upload=await this.sb.storage.from(EVIDENCE_BUCKET).upload(path,record.blob,
          {contentType:'image/jpeg',cacheControl:'3600',upsert:false});
        // La ruta es única por evento. Un archivo existente implica reintento,
        // no reemplazo. La base validará el movimiento confirmado.
        if(upload.error && !/already exists|duplicate|resourcealreadyexists|409/i.test(errorText(upload.error))){
          throw upload.error;
        }
        const result=await this.sb.from('vantis_evidencias_escaneo').insert({
          evento_id:record.id,departamento_id:this.departmentId,sku:record.sku,
          codigo_leido:record.code,objeto_path:path,usuario_id:this.userId,
          capturada_en:record.capturedAt
        });
        if(result.error && String(result.error.code)!=='23505')throw result.error;
        await remove(record.id);
        this.lastError='';
      }
      more=pending.length>batch.length;
    }catch(error){failed=true;this.issue('Imagen pendiente de sincronizar: '+errorText(error));}
    finally {
      this.uploading=false;
      if(more&&!failed&&!this.retryScheduled){
        this.retryScheduled=true;
        setTimeout(()=>{this.retryScheduled=false;void this.sync();},250);
      }
    }
  }
  dispose(){globalThis.removeEventListener?.('online',this.online);}
}
export async function listLocalSkuEvidence(departmentId,userId,sku,{limit=6}={}) {
  const rows=(await all()).filter(row=>row.departmentId===departmentId&&row.userId===userId&&row.sku===sku)
    .sort((a,b)=>String(b.capturedAt).localeCompare(String(a.capturedAt))).slice(0,limit);
  return rows.map(row=>({
    evento_id:row.id,capturada_en:row.capturedAt,codigo_leido:row.code,
    url:URL.createObjectURL(row.blob),local:true
  }));
}

export async function listSkuEvidence(sb,departmentId,sku,{limit=6}={}) {
  const response=await sb.from('vantis_evidencias_escaneo')
    .select('evento_id,capturada_en,objeto_path,codigo_leido')
    .eq('departamento_id',departmentId).eq('sku',sku)
    .order('capturada_en',{ascending:false}).limit(limit);
  if(response.error)throw response.error;
  const items=await Promise.all((response.data||[]).map(async item=>{
    const result=await sb.storage.from(EVIDENCE_BUCKET).createSignedUrl(item.objeto_path,600);
    return {...item,url:result.error?'':(result.data?.signedUrl||'')};
  }));
  return items;
}
