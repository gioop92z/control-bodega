// VANTIS GitHub Local: all inventory writes are atomic on this device.
// No Supabase, GitHub token, third-party database or external API.
export const LOCAL_DEPARTMENT = 'ZAPATERIA INFANTIL';
const DB_NAME = 'vantis-github-local-v1';
const STORES = ['labels','products','assignments','receipts','evidence'];
const makeError = (message,code='LOCAL_ERROR') => Object.assign(new Error(message),{code});
const storageError = cause => makeError('No se pudo guardar en este dispositivo. No borres los datos ni sigas escaneando hasta disponer de almacenamiento local: '+(cause?.message||cause||'error desconocido'),'LOCAL_STORAGE_ERROR');

function openDB() {
  if(typeof indexedDB==='undefined') return Promise.reject(storageError('IndexedDB no disponible'));
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      for(const name of STORES)if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(storageError(req.error));
    req.onblocked=()=>reject(storageError('Otra pestaña bloquea el inventario'));
  });
}
const request = q => new Promise((resolve,reject)=>{
  q.onsuccess=()=>resolve(q.result);
  q.onerror=()=>reject(storageError(q.error));
});
function transaction(db,names,mode,work) {
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(names,mode);
    let result,problem;
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(problem||storageError(tx.error));
    tx.onerror=()=>{};
    (async()=>{try{result=await work(tx);}catch(e){problem=e;try{tx.abort();}catch{reject(e);}}})();
  });
}
function normalizeLabel(input){
  const c=String(input||'').trim().toUpperCase();
  const m=c.match(/^(?:ZAP-)?(402|405|459)-(\d{3,4})$/);
  if(!m)throw makeError('Marbete no válido: escanea una ubicación 402, 405 o 459.','22023');
  return 'ZAP-'+m[1]+'-'+m[2];
}
function validNumeric(code){return /^\d{6,20}$/.test(String(code||''));}
const assignmentId=(sku,code)=>sku+'|'+code;
const clone=value=>JSON.parse(JSON.stringify(value));
export class LocalInventoryApi {
  constructor(deptId=LOCAL_DEPARTMENT){
    this.deptId=deptId;
    this.acceptAnyNumericCode=true;
    this.mode='local';
    this.dbPromise=openDB();
  }
  async capabilities(){
    const db=await this.dbPromise;
    if(!db.objectStoreNames.contains('receipts'))throw makeError('Almacenamiento local incompleto.');
    // A read-only probe; a "ready" session must still check each actual write.
    await transaction(db,['receipts'],'readonly',async tx=>{
      await request(tx.objectStore('receipts').count());
    });
    return {version:1,atomic:true,idempotent:true};
  }
  async activate(code){
    const label=normalizeLabel(code),db=await this.dbPromise;
    return transaction(db,['labels'],'readwrite',async tx=>{
      const s=tx.objectStore('labels');
      let row=await request(s.get(label));
      if(!row){
        row={id:label,codigo:label,departamento_id:this.deptId,zona:'BODEGA',activo:true,created_at:new Date().toISOString()};
        await request(s.add(row));
      }
      if(row.departamento_id!==this.deptId||!row.activo)
        throw makeError('Marbete no permitido en este departamento.','22023');
      return {codigo:row.codigo,departamento_id:row.departamento_id,activo:true};
    });
  }
  async lookup(codes){
    const db=await this.dbPromise;
    return transaction(db,['products'],'readonly',async tx=>{
      const s=tx.objectStore('products'),result=new Map();
      for(const code of codes){
        const row=await request(s.get(code));
        result.set(code,row?{product:row}:{product:null});
      }
      return result;
    });
  }
  async ensureProduct(code){
    if(!validNumeric(code))throw makeError('SKU o UPC fuera de formato.','22023');
    const db=await this.dbPromise;
    return transaction(db,['products'],'readwrite',async tx=>{
      const s=tx.objectStore('products');
      let row=await request(s.get(code));
      if(!row){
        row={id:code,sku:code,upc:null,descripcion:'SKU/UPC '+code,stock:0,activo:true,departamento_id:this.deptId};
        await request(s.add(row));
      }
      if(!row.activo||row.departamento_id!==this.deptId)throw makeError('Producto no disponible en este departamento.','22023');
      return row;
    });
  }
  async receive(payload){
    const db=await this.dbPromise;
    return transaction(db,['products','labels','assignments','receipts'],'readwrite',async tx=>{
      const receipts=tx.objectStore('receipts');
      const prior=await request(receipts.get(payload.p_id));
      const signature=JSON.stringify(payload);
      if(prior){
        if(prior.signature!==signature)throw makeError('El folio pertenece a otra lectura.','22023');
        return prior.receipt;
      }
      if(!payload.p_id||!payload.p_sesion||!payload.p_operador||payload.p_departamento!==this.deptId)
        throw makeError('Lectura incompleta.','22023');
      const label=normalizeLabel(payload.p_marbete);
      const location=await request(tx.objectStore('labels').get(label));
      if(!location||location.departamento_id!==this.deptId||!location.activo)
        throw makeError('Escanea de nuevo el marbete.','22023');
      const products=tx.objectStore('products');
      const product=await request(products.get(payload.p_producto));
      if(!product||!product.activo||product.departamento_id!==this.deptId)
        throw makeError('Producto no encontrado en la base local.','22023');
      const reversing=Boolean(payload.p_reversa);
      if(reversing){
        const original=await request(receipts.get(payload.p_reversa));
        if(!original||original.receipt.kind!=='receive'||original.receipt.session_id!==payload.p_sesion||
           original.receipt.product_id!==product.id||original.receipt.marbete_codigo!==label)
          throw makeError('La lectura original no corresponde a esta reversa.','22023');
      }
      const delta=reversing?-1:1;
      const store=tx.objectStore('assignments'),key=assignmentId(product.sku,label);
      const assignment=await request(store.get(key))||{id:key,sku:product.sku,marbete_codigo:label,cantidad:0};
      if(product.stock+delta<0||assignment.cantidad+delta<0)throw makeError('Existencia insuficiente para deshacer.','22023');
      if(reversing){
        // A second compensation must not decrement stock again.
        const all=await request(receipts.getAll());
        if(all.some(r=>r.payload?.p_reversa===payload.p_reversa))
          throw makeError('Esta lectura ya fue compensada.','22023');
      }
      product.stock+=delta;
      assignment.cantidad+=delta;
      await request(products.put(product));
      await request(store.put(assignment));
      const receipt={
        id:payload.p_id,session_id:payload.p_sesion,user_id:'local-device',
        product_id:product.id,sku:product.sku,marbete_codigo:label,
        quantity:1,kind:reversing?'undo':'receive',stock_resultante:product.stock,
        location_quantity:assignment.cantidad,stored_at:new Date().toISOString()
      };
      await request(receipts.add({id:payload.p_id,signature,payload:clone(payload),receipt}));
      return receipt;
    });
  }
  async saveEvidence(id,blob){
    if(!(blob instanceof Blob)||!blob.size)return false;
    const db=await this.dbPromise;
    await transaction(db,['evidence'],'readwrite',tx=>request(tx.objectStore('evidence').put({id,blob,savedAt:new Date().toISOString()})));
    return true;
  }
  async summary(){
    const db=await this.dbPromise;
    return transaction(db,['products','labels','receipts'],'readonly',async tx=>{
      const products=tx.objectStore('products'),receipts=tx.objectStore('receipts');
      const [p,l,r]=await Promise.all([
        request(products.getAll()),request(tx.objectStore('labels').count()),request(receipts.count())
      ]);
      return {products:p.length,labels:l,receipts:r,units:p.reduce((sum,x)=>sum+Number(x.stock||0),0)};
    });
  }
  async exportBackup(){
    const db=await this.dbPromise;
    const items=await transaction(db,STORES.filter(x=>x!=='evidence'),'readonly',async tx=>{
      const result={};
      for(const name of STORES.filter(x=>x!=='evidence'))result[name]=await request(tx.objectStore(name).getAll());
      return result;
    });
    return {format:'vantis-github-local-backup',version:1,createdAt:new Date().toISOString(),
      deviceOnly:true,photosExcluded:true,department:this.deptId,items};
  }
  async restoreBackup(backup){
    if(backup?.format!=='vantis-github-local-backup'||backup?.version!==1||backup.department!==this.deptId)
      throw makeError('Respaldo de VANTIS no válido o de otro departamento.');
    for(const name of STORES.filter(x=>x!=='evidence'))if(!Array.isArray(backup.items?.[name]))
      throw makeError('Respaldo incompleto: '+name);
    if(backup.items.receipts.length>120000)throw makeError('El respaldo contiene demasiadas lecturas.');
    const db=await this.dbPromise;
    // Restore only into an empty inventory to prevent accidental stock doubles.
    return transaction(db,STORES.filter(x=>x!=='evidence'),'readwrite',async tx=>{
      for(const name of STORES.filter(x=>x!=='evidence')){
        const count=await request(tx.objectStore(name).count());
        if(count)throw makeError('Este dispositivo ya tiene inventario. No se mezclará con el respaldo.');
      }
      for(const name of STORES.filter(x=>x!=='evidence')){
        const s=tx.objectStore(name);
        for(const row of backup.items[name]){
          if(!row||typeof row.id!=='string'||!row.id)throw makeError('Archivo de respaldo corrupto.');
          // Queue all restores synchronously inside one atomic transaction.
          s.add(row);
        }
      }
      return backup.items.receipts.length;
    });
  }
}
