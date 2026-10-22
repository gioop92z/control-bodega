// Diario redundante en IndexedDB: localStorage sigue siendo la confirmación sincrónica.
// Los movimientos recuperados mantienen su UUID original y se reconcilian por el RPC idempotente.
const NAME='vantis-recepcion-respaldo-v5',STORE='entries';
const hasIDB=()=>typeof indexedDB!=='undefined';
function db(){
 if(!hasIDB())return Promise.reject(Error('IndexedDB no está disponible'));
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(NAME,1);
  req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE);};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('No se pudo abrir IndexedDB'));
 });
}
export class InventoryJournalMirror{
 constructor(scope){this.scope=scope;this.pending=new Map();this.error='';this.timer=null;this.chain=Promise.resolve();}
 key(type,id=''){return this.scope+'/'+type+'/'+id;}
 queue(type,id,value){
  if(!hasIDB())return;
  this.pending.set(this.key(type,id),structuredClone(value));
  if(this.pending.size>=40)this.flush();
  else if(!this.timer)this.timer=setTimeout(()=>this.flush(),70);
 }
 flush(){
  clearTimeout(this.timer);this.timer=null;
  if(!this.pending.size)return this.chain;
  const rows=[...this.pending.entries()];this.pending.clear();
  this.chain=this.chain.catch(()=>{}).then(async()=>{
   const d=await db();
   try{await new Promise((resolve,reject)=>{
    const tx=d.transaction(STORE,'readwrite'),s=tx.objectStore(STORE);
    for(const [key,value] of rows)s.put(value,key);
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('No se pudo guardar el respaldo'));tx.onerror=()=>reject(tx.error);
   });this.error='';}
   finally{d.close();}
  }).catch(error=>{this.error=String(error?.message||error);});
  return this.chain;
 }
 async read(type,id=''){
  if(!hasIDB())return null;
  await this.flush();
  const d=await db();
  try{return await new Promise((resolve,reject)=>{
   const q=d.transaction(STORE,'readonly').objectStore(STORE).get(this.key(type,id));
   q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);
  });}finally{d.close();}
 }
 async readRows(sessionId){
  if(!hasIDB())return [];
  await this.flush();const d=await db(),prefix=this.key('row',sessionId+'/');
  try{return await new Promise((resolve,reject)=>{
   const a=[],tx=d.transaction(STORE,'readonly'),range=IDBKeyRange.bound(prefix,prefix+'\uffff');
   const req=tx.objectStore(STORE).openCursor(range);
   req.onsuccess=()=>{const c=req.result;if(c){a.push(c.value);c.continue();}else resolve(a.sort((x,y)=>x.sequence-y.sequence));};
   req.onerror=()=>reject(req.error);
  });}finally{d.close();}
 }
 async status(){return {available:hasIDB(),error:this.error};}
 async dispose(){await this.flush();}
}
