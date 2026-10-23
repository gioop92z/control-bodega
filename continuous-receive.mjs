import {parseMarbeteScan, locationQuery} from './product-location.mjs?v=3.9.5';
import {cleanSupportCode, lookupSupportCodes} from './support-batch.mjs?v=3.8.0';
import {LegacyReceiptApi} from './legacy-receipt-api.mjs?v=3.10.1';
import {InventoryJournalMirror} from './vantis-offline-idb-v5.mjs';
import {scanMetric,startMetric,serverMetric} from './vantis-telemetry-v5.mjs';

const message = error => String(error?.message || error || 'No se pudo guardar.');
const permanent = error => /^(22|23|P0001)/.test(String(error?.code || ''));
const missing = error => /PGRST202|42883/.test(String(error?.code || ''));
const uuid = () => crypto.randomUUID();
// La petición puede quedarse esperando indefinidamente en Safari aunque haya Wi-Fi.
// Timeout de diagnóstico: una escritura que no respondió es INCIERTA, nunca fallida.
// Se reutiliza el mismo UUID en cualquier recuperación (RPC idempotente).
export function withNetworkDeadline(action,label,ms=18000){
  let timer;
  return Promise.race([
    Promise.resolve().then(action),
    new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Object.assign(
        new Error(label+' agotó el tiempo de respuesta. La lectura sigue protegida para conciliación.'),
        {code:'VANTIS_TIMEOUT'})),ms);
    })
  ]).finally(()=>clearTimeout(timer));
}
const canonical = code => {
  try { const value = parseMarbeteScan(code); return /^ZAP-(402|405|459)-\d{3,4}$/.test(value) ? value : null; }
  catch { return null; }
};

// Each row is written separately, synchronously, BEFORE any network request.
// A crash between row and session writes is recovered by enumerating the journal.
export class ReceiptJournal {
  constructor(storage, scope) { this.storage = storage; this.base = 'vantis.continuous.v1/' + scope; }
  readSession() {
    const id = this.storage.getItem(this.base + '/active');
    return id ? JSON.parse(this.storage.getItem(this.base + '/session/' + id) || 'null') : null;
  }
  saveSession(session) {
    this.storage.setItem(this.base + '/session/' + session.id, JSON.stringify(session));
    this.storage.setItem(this.base + '/active', session.id);
  }
  readRows(sessionId) {
    const prefix = this.base + '/row/' + sessionId + '/', rows = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(prefix)) rows.push(JSON.parse(this.storage.getItem(key)));
    }
    return rows.sort((a,b) => a.sequence - b.sequence);
  }
  saveRow(sessionId, row) { this.storage.setItem(this.base + '/row/' + sessionId + '/' + row.id, JSON.stringify(row)); }
}

export class SupabaseReceiptApi {
  constructor(sb, deptId) { this.sb = sb; this.deptId = deptId; this.legacy = new LegacyReceiptApi(sb,deptId); this.mode='modern'; }
  async capabilities() {
    try {
      const result=await locationQuery(this.sb.rpc('vantis_recepcion_estado_v1', {}));
      this.mode='modern'; return result;
    } catch(error) {
      if(!missing(error))throw error;
      // If the compatibility preflight cannot inspect this department,
      // preserve the original "server missing" fallback to batch receiving.
      let result;
      try { result=await this.legacy.capabilities(); }
      catch { throw error; }
      this.mode='legacy'; return result;
    }
  }
  async activate(code) { return this.mode==='legacy'
    ? this.legacy.activate(code)
    : locationQuery(this.sb.rpc('vantis_activar_marbete_v1', {p_departamento:this.deptId, p_codigo:code})); }
  lookup(codes) { return lookupSupportCodes(this.sb, codes, this.deptId); }
  async ensureProduct(raw){
    const code=cleanSupportCode(raw),before=await this.lookup([code]);
    if(before.get(code)?.product)return before.get(code).product;
    if(/ambiguo/i.test(before.get(code)?.error||''))throw Error('UPC ambiguo: escanea el SKU específico.');
    let failure=null;
    try {await locationQuery(this.sb.rpc('crear_producto_codigo',{p_token:null,p_departamento:this.deptId,p_codigo:code}));}
    catch(error){failure=error;}
    const after=await this.lookup([code]),product=after.get(code)?.product;
    if(product?.id&&product.sku===code&&product.activo&&product.departamento_id===this.deptId)return product;
    throw Error('SKU '+code+' pendiente de alta: '+(failure?.message||'el servidor no confirmó la creación.'));
  }
  async receive(payload) { return locationQuery(this.sb.rpc('vantis_recibir_pieza_v1', payload)); }
  legacyReceive(payload,options) { return this.legacy.receive(payload,options); }
}

export class ContinuousReceive {
  constructor({api, storage, userId, deptId, actor, locks = globalThis.navigator?.locks,
    online = () => globalThis.navigator?.onLine !== false, makeId = uuid,
    onChange = () => {}, onConfirmed = () => {}, onFailure = () => {}, now = () => Date.now()}) {
    Object.assign(this, {api, storage, userId, deptId, actor, locks, online, makeId, onChange, onConfirmed, onFailure, now});
    this.journal = new ReceiptJournal(storage, [userId,deptId,encodeURIComponent(actor)].join('/'));
    this.mirror=new InventoryJournalMirror(this.journal.base);
    this.restoredFromBackup=false;
    this.compacting=null;this.compactedThrough=0;
    this.cache = new Map(); this.timer = null; this.job = null; this.owned = false; this.disposed = false;
    this.storageError = ''; this.error = ''; this.backend = 'checking'; this.selecting = false; this.compatibility = false;
    this.release = null; this.nextSequence = 0;
    try {
      this.state = this.journal.readSession() || this.empty();
      if (this.state.version !== 1 || this.state.userId !== userId || this.state.deptId !== deptId || this.state.actor !== actor) throw Error('Sesión local incompatible.');
      this.rows = this.journal.readRows(this.state.id);
      for (const row of this.rows) {
        if (!row.id || row.sessionId !== this.state.id || !Number.isSafeInteger(row.sequence) ||
          !['queued','sending','uncertain','confirmed','failed'].includes(row.status)) throw Error('Diario local incompleto.');
        this.nextSequence = Math.max(this.nextSequence,row.sequence);
        if (row.status === 'sending') row.status = 'uncertain';
      }
    } catch (error) {
      this.state ||= this.empty(); this.rows ||= [];
      this.storageError = 'No se puede recuperar el diario local: ' + message(error) + ' Conserva este navegador; no borres sus datos.';
    }
  }
  empty() {
    return {version:1,id:this.makeId(),userId:this.userId,deptId:this.deptId,actor:this.actor,
      startedAt:new Date(this.now()).toISOString(),endedAt:null,active:null,candidate:null,pendingSwitch:null,backendVersion:0};
  }
  saveSession() {
    try { this.journal.saveSession(this.state); this.mirror.queue('active','',this.state); return true; }
    catch { this.storageError = 'Almacenamiento local lleno o no disponible. No escanees más hasta recuperar espacio.'; this.onChange(); return false; }
  }
  saveRow(row) {
    try { this.journal.saveRow(this.state.id,row); this.mirror.queue('row',this.state.id+'/'+row.id,row); return true; }
    catch { this.storageError = 'No pude proteger esta lectura en el navegador. Detén el escaneo y conserva la pantalla.'; this.onChange(); return false; }
  }
  changed() { this.onChange(); }
  get busy() { return Boolean(this.job || this.selecting); }
  get pending() { return this.rows.filter(row => !['confirmed','failed'].includes(row.status)).length; }
  get canScan() { return this.owned && !this.disposed && !this.storageError && !this.state.endedAt && !this.state.pendingSwitch && !['missing','invalid','denied','checking'].includes(this.backend); }
  async start() {
    if(this.storageError){this.backend='denied';this.changed();return;}
    if (!this.actor) { this.error = 'Identifica tu gafete al iniciar sesión antes de recibir mercancía.'; this.backend = 'denied'; this.changed(); return; }
    if (!this.locks?.request) { this.error = 'Este navegador necesita soporte de Web Locks. Abre VANTIS en un navegador actualizado.'; this.backend = 'denied'; this.changed(); return; }
    await new Promise(resolve => {
      this.lease = this.locks.request(this.journal.base, {ifAvailable:true}, async lock => {
        if (!lock) { this.error = 'Esta recepción está abierta en otra pestaña. Continúa allí o ciérrala.'; resolve(); return; }
        this.owned = true;
        await new Promise(release => { this.release = release; resolve(); });
        this.owned = false;
      }).catch(error => {this.error=message(error);resolve();});
    });
    if (!this.owned || this.disposed) { this.release?.(); this.changed(); return; }
    // Re-read after acquiring the lease; the previous owner may have saved
    // a newer session. Construction never writes another tab's metadata.
    try {
      const saved=this.journal.readSession();
      if(saved){
        this.state=saved;
        const localRows=this.journal.readRows(saved.id);
        // Old confirmed rows may have been safely compacted out of localStorage.
        // The copy in IndexedDB is read under the exclusive Web Lock.
        let archived=[];
        try{archived=await this.mirror.readRows(saved.id);}
        catch(e){this.mirror.error=String(e?.message||e);}
        if(Number(saved.compactedThrough||0)>0 && !archived.length)
          throw Error('No se pudo recuperar la parte archivada del diario. Conserva los datos del navegador.');
        const merged=new Map(archived.map(row=>[row.id,row]));
        for(const row of localRows)merged.set(row.id,row); // freshest local status always wins
        this.rows=[...merged.values()].sort((a,b)=>a.sequence-b.sequence);
        this.compactedThrough=Number(saved.compactedThrough||0);
      } else {
        // Restore only when the synchronous session pointer is absent; never
        // combine two divergent journals or invent confirmations.
        let backup=null;
        try{backup=await this.mirror.read('active','');}
        catch(e){this.mirror.error=String(e?.message||e);}
        if(backup?.version===1&&backup.userId===this.userId&&backup.deptId===this.deptId&&
           backup.actor===this.actor&&backup.id&&!backup.endedAt){
          const rows=await this.mirror.readRows(backup.id);
          this.state=backup;this.rows=rows;this.nextSequence=0;
          for(const row of rows){
            if(!row.id||row.sessionId!==backup.id||!Number.isSafeInteger(row.sequence))
              throw Error('El respaldo local requiere revisión.');
            this.journal.saveRow(backup.id,row);
          }
          this.restoredFromBackup=true;
        }
      }
      for(const row of this.rows){if(row.status==='sending')row.status='uncertain';this.nextSequence=Math.max(this.nextSequence,row.sequence);}
      if(!this.saveSession())return;
    }catch(error){this.storageError='No se pudo recuperar la sesión local: '+message(error);this.changed();return;}
    await this.connect();
  }
  async connect() {
    if (!this.owned || this.disposed || this.storageError) return;
    try {
      if (!this.online()) throw Error('Sin conexión.');
      const result = await withNetworkDeadline(()=>this.api.capabilities(),'Consulta al servidor');
      const compatible = result?.version===1 && result?.mode==='legacy' &&
        result?.atomic===false && result?.idempotent===false && result?.guarded===true;
      const modern = result?.version===1 && result?.atomic===true && result?.idempotent===true;
      if (!modern && !compatible) {
        this.backend = 'invalid'; throw Error('El servidor no confirma un contrato de recepción permitido.');
      }
      this.compatibility = compatible;
      this.backend = 'ready'; this.error = ''; this.state.backendVersion = compatible?-1:1; this.saveSession();
      if (this.state.candidate) await this.activateCandidate();
      else if (this.state.active) {
        // Revalidate restored labels before sending any new or recovered row.
        const active = this.state.active;
        this.state.candidate = active; this.state.active = null; this.saveSession();
        await this.activateCandidate();
      }
      this.schedule(0);
    } catch (error) {
      if (missing(error)) { this.backend = 'missing'; this.error = 'La recepción continua requiere activar la migración del servidor. La recepción por lote sigue disponible.'; }
      else if (String(error?.code) === '42501' || /JWT|PGRST30/.test(String(error?.code))) { this.backend = 'denied'; this.error = 'El servidor no autoriza esta sesión. Vuelve a iniciar sesión.'; }
      else { if (this.backend !== 'invalid') this.backend = [1,-1].includes(this.state.backendVersion) ? 'offline' : 'checking'; this.error = message(error); this.schedule(4000); }
    }
    this.changed();
  }
  scan(raw, {eventId} = {}) {
    if (!this.canScan) throw Error(this.storageError || (this.state.pendingSwitch ? 'Confirma o cancela el cambio de marbete antes de escanear.' : this.error || 'Espera a que el lector esté listo.'));
    const code = String(raw ?? '').trim(), label = canonical(code);
    if (label) {
      if(this.selecting)throw Error('Espera a validar el marbete antes de cambiar de ubicación. Las piezas sí se pueden seguir escaneando.');
      const current = this.state.candidate || this.state.active;
      if (current && canonical(current.code) === label) return {type:'same-location'};
      if (this.state.active || this.state.candidate) {
        this.state.pendingSwitch = {code:label};
        if (!this.saveSession()) throw Error(this.storageError);
        this.changed(); return {type:'switch'};
      }
      this.setCandidate(label); return {type:'location'};
    }
    const location = this.state.candidate || this.state.active;
    const productCode = cleanSupportCode(code), id = eventId || this.makeId();
    if (eventId && this.rows.some(row => row.id === id)) return {type:'duplicate-event',id};
    const row = {id,sessionId:this.state.id,sequence:++this.nextSequence,kind:'receive',
      code:productCode,quantity:1,location:location?.code||null,visitId:location?.visitId||null,unlocatedApproved:false,
      capturedAt:new Date(this.now()).toISOString(),status:'queued',attempts:0,error:'',product:null,payload:null};
    if (!this.saveRow(row)) { this.nextSequence--; throw Error(this.storageError); }
    this.rows.push(row); scanMetric(); this.changed(); this.schedule(25); return {type:'piece',id};
  }
  setCandidate(code) {
    const candidate={code,visitId:this.makeId()};
    if(!this.state.active&&!this.state.candidate){
      for(const row of this.rows.filter(r=>r.kind==='receive'&&!r.location&&!r.unlocatedApproved)){
        const updated={...row,location:code,visitId:candidate.visitId};
        if(!this.saveRow(updated))throw Error(this.storageError);
        Object.assign(row,updated);
      }
    }
    this.state.candidate=candidate;
    if(!this.saveSession())throw Error(this.storageError);
    this.changed();
    if(this.backend==='ready')void this.activateCandidate();
  }
  approveWithoutLocation(){
    if(!this.canScan)throw Error('La recepción no está preparada para guardar sin ubicación.');
    const rows=this.rows.filter(r=>r.kind==='receive'&&!r.location&&!r.unlocatedApproved&&r.status==='queued');
    if(!rows.length)throw Error('No hay lecturas esperando ubicación.');
    for(const row of rows){
      const updated={...row,unlocatedApproved:true};
      if(!this.saveRow(updated))throw Error(this.storageError);
      Object.assign(row,updated);
    }
    this.changed();this.schedule(0);return rows.length;
  }
  confirmSwitch(accept) {
    const request = this.state.pendingSwitch; if (!request) return;
    this.state.pendingSwitch = null;
    if (accept) this.setCandidate(request.code);
    else { this.saveSession(); this.changed(); }
  }
  async activateCandidate() {
    if (this.selecting || !this.state.candidate || !this.online() || this.backend !== 'ready') return;
    const target = this.state.candidate; this.selecting = true; this.changed();
    try {
      const location = await withNetworkDeadline(()=>this.api.activate(target.code),'Validación del marbete');
      if (!location?.codigo || canonical(location.codigo) !== canonical(target.code) || location.departamento_id !== this.deptId || location.activo !== true) throw Object.assign(Error('El servidor no confirmó el marbete.'), {code:'P0001'});
      // Rows captured during validation keep their visit and canonical server ID.
      for (const row of this.rows.filter(row => row.visitId === target.visitId && !row.payload)) {
        row.location = location.codigo;
        if (!this.saveRow(row)) return;
      }
      this.state.active = {...target,code:location.codigo}; this.state.candidate = null;
      this.error = ''; this.saveSession();
    } catch (error) {
      this.error = 'Marbete sin activar: ' + message(error);
      if (permanent(error)) {
        for (const row of this.rows.filter(row => row.visitId === target.visitId && !row.payload)) {
          const updated={...row,location:null,visitId:null,unlocatedApproved:false,status:'queued',error:'Marbete rechazado. La pieza sigue pendiente.'};
          if(!this.saveRow(updated))break;
          Object.assign(row,updated);
        }
        this.state.candidate = null; this.saveSession();
      } else { this.backend = 'offline'; this.schedule(4000); }
    } finally { this.selecting = false; this.changed(); this.schedule(25); }
  }
  schedule(delay = 25) {
    if (this.timer || this.disposed || !this.owned || this.storageError || ['missing','invalid','denied'].includes(this.backend)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.backend !== 'ready') void this.connect();
      else void this.flush();
    },delay);
  }
  async flush() {
    if (this.job) return this.job;
    clearTimeout(this.timer); this.timer = null;
    if (!this.owned || this.disposed || this.storageError || this.backend !== 'ready' || !this.online()) return;
    this.job = this.process(); this.changed();
    try { await this.job; }
    finally {
      this.job=null;this.changed();
      await this.compactJournal();
      const actionable=this.rows.filter(r=>['queued','uncertain'].includes(r.status)&&(r.location||r.unlocatedApproved));
      if(actionable.length&&!this.disposed){
        const retry=Math.min(...actionable.map(r=>Math.max(0,(r.retryAt||0)-this.now())));
        this.schedule(Math.max(1000,Math.min(30000,retry||1000)));
      }
    }
  }
  async compactJournal(){
    if(this.compacting)return this.compacting;
    if(this.rows.length<420||!this.mirror||this.mirror.error||typeof indexedDB==='undefined')return;
    this.compacting=(async()=>{
      const threshold=Math.max(0,this.rows.length-240);
      const targets=this.rows.slice(0,threshold).filter(r=>r.sequence>this.compactedThrough&&r.status==='confirmed');
      if(targets.length<60)return;
      await this.mirror.flush();
      if(this.mirror.error)return;
      // Persist an archive checkpoint before trimming local copies.
      const maxSeq=Math.max(...targets.map(r=>r.sequence));
      this.state.compactedThrough=maxSeq;
      if(!this.saveSession())return;
      for(const row of targets)try{
        this.storage.removeItem(this.journal.base+'/row/'+this.state.id+'/'+row.id);
      }catch(error){this.mirror.error=String(error?.message||error);break;}
      this.compactedThrough=maxSeq;
    })();
    try{await this.compacting;}finally{this.compacting=null;}
  }
  async process() {
    if (this.state.candidate) { await this.activateCandidate(); if (this.state.candidate) return; }
    while (!this.disposed && !this.storageError && this.backend === 'ready' && this.online()) {
      const candidates = this.rows.filter(row => ['queued','uncertain'].includes(row.status) && (!row.retryAt || row.retryAt <= this.now()) && row.visitId !== this.state.candidate?.visitId).slice(0,75);
      if (!candidates.length) break;
      const unresolved = candidates.filter(row => !row.payload && !row.product && row.kind === 'receive');
      try {
        const codes = [...new Set(unresolved.map(row => row.code))].filter(code => !this.cache.has(code));
        if (codes.length) for (const [code,result] of await withNetworkDeadline(()=>this.api.lookup(codes),'Consulta de catálogo')) if (result.product) this.cache.set(code,result.product);
        const issues=new Map();
        for(const code of new Set(unresolved.filter(r=>!this.cache.has(r.code)).map(r=>r.code))){
          try{
            if(!this.api.ensureProduct)throw Error('El servidor no admite alta automática de artículos.');
            const product=await withNetworkDeadline(()=>this.api.ensureProduct(code),'Alta de SKU');
            if(!product?.id||!product.activo||product.departamento_id!==this.deptId)throw Error('El catálogo no confirmó el artículo.');
            this.cache.set(code,product);
          }catch(error){issues.set(code,message(error));}
        }
        for(const row of unresolved){
          const product=this.cache.get(row.code);
          if(product?.activo&&product.departamento_id===this.deptId){
            row.product=product;row.error='';delete row.retryAt;this.saveRow(row);
          }else{
            row.error=issues.get(row.code)||'SKU pendiente de confirmar en el catálogo.';
            row.retryAt=this.now()+15000;
            if(!this.saveRow(row))return;
            this.onFailure(row);
          }
        }
      } catch (error) { this.backend = 'offline'; this.error = 'Lecturas protegidas; catálogo pendiente: ' + message(error); break; }
      // Four requests can be in flight; each transaction locks its product on
      // the server. Input capture remains independent of network latency.
      const ready = candidates.filter(row => row.product&&(row.location||row.unlocatedApproved)&&row.status !== 'failed'&&row.visitId!==this.state.candidate?.visitId);
      // SKU-first readings can sit in local staging indefinitely. Do not spin
      // while there is no server movement ready to commit.
      if(!ready.length)break;
      for (let offset = 0; offset < ready.length; offset += 4) {
        if (this.disposed || this.storageError || this.backend !== 'ready' || !this.online()) break;
        await Promise.all(ready.slice(offset,offset+4).map(row => this.send(row)));
      }
      this.changed();
    }
  }
  async send(row) {
    if (!row.payload) row.payload = {
      p_id:row.id,p_sesion:this.state.id,p_departamento:this.deptId,p_producto:row.product.id,
      p_marbete:row.location,p_operador:this.actor,p_leida_en:row.capturedAt,p_reversa:row.reverses || null
    };
    // Persist transport choice before sending. If the migration is installed
    // mid-session, old uncertain writes must only be RECONCILED, never sent
    // through the new RPC as fresh inventory.
    row.writeMode ||= (!row.location||this.compatibility) ? 'legacy' : 'modern';
    row.status = 'sending'; row.attempts++;
    if (!this.saveRow(row)) return;
    this.changed();
    const started=startMetric();
    try {
      const reply = await withNetworkDeadline(() => row.writeMode==='legacy'
        ? this.api.legacyReceive(structuredClone(row.payload),{
            allowWrite:row.attempts===1,sku:row.product.sku,userId:this.userId
          })
        : this.api.receive(structuredClone(row.payload)), 'Confirmación de pieza');
      if (reply?.id !== row.id || reply.session_id !== this.state.id || reply.user_id !== this.userId ||
        reply.product_id !== row.product.id || reply.sku !== row.product.sku || reply.marbete_codigo !== row.location ||
        reply.kind !== row.kind || reply.quantity !== 1 || !Number.isFinite(Date.parse(reply.stored_at)) || reply.stock_resultante == null || !Number.isSafeInteger(Number(reply.stock_resultante))) {
        this.backend = 'invalid'; throw Error('Respuesta de almacenamiento incompleta. Esta lectura queda por verificar.');
      }
      serverMetric(started,true);
      row.status = 'confirmed'; row.receipt = reply; row.error = ''; delete row.retryAt;
      this.saveRow(row); this.onConfirmed(row);
    } catch (error) {
      serverMetric(started,false);
      row.error = message(error);
      if (permanent(error)) { row.status = 'failed'; this.onFailure(row); }
      else {
        row.status = 'uncertain'; row.retryAt = this.now() + Math.min(30000,1000 * 2 ** Math.min(row.attempts-1,5));
        if (missing(error)) this.backend = 'missing';
        else if (String(error?.code) === '42501' || /PGRST30/.test(String(error?.code))) this.backend = 'denied';
        else if (this.backend !== 'invalid') this.backend = 'offline';
        this.error = 'Hay lecturas pendientes de confirmación: ' + message(error);
      }
      this.saveRow(row);
    }
    this.changed();
  }
  undoLast() {
    if (this.compatibility) throw Error('El deshacer automático necesita la migración segura. Revisa el movimiento en el historial.');
    if (!this.canScan) throw Error('Reanuda la recepción antes de deshacer.');
    const reversed = new Set(this.rows.filter(row => row.kind === 'undo' && row.status !== 'failed').map(row => row.reverses));
    const original = [...this.rows].reverse().find(row => row.kind === 'receive' && row.location && row.status === 'confirmed' && !reversed.has(row.id));
    if (!original) throw Error('No hay una entrada confirmada que se pueda deshacer.');
    const row = {id:this.makeId(),sessionId:this.state.id,sequence:++this.nextSequence,kind:'undo',
      code:original.code,quantity:1,location:original.location,visitId:original.visitId,reverses:original.id,
      capturedAt:new Date(this.now()).toISOString(),status:'queued',attempts:0,error:'',product:structuredClone(original.product),payload:null};
    if (!this.saveRow(row)) throw Error(this.storageError);
    this.rows.push(row); this.changed(); this.schedule(0); return row;
  }
  retryFailures() {
    for (const row of this.rows.filter(row => row.status === 'failed')) {
      row.status = 'queued'; row.error = ''; row.retryAt = 0;
      if (!row.payload) row.product = null;
      this.saveRow(row);
    }
    this.cache.clear(); this.changed(); void this.reconnect();
  }
  async reconnect() {
    if (!this.owned || this.disposed || this.storageError) return;
    // Si hay solicitudes en curso, deja que finalicen (o agoten su plazo)
    // antes de lanzar otra consulta. Los folios no cambian jamás.
    if(this.job) await this.job;
    for(const row of this.rows)if(row.status==='uncertain')row.retryAt=0;
    if(this.backend!=='ready')await this.connect();
    if(this.backend==='ready')await this.flush();
    this.changed();
  }
  pendingDetails() {
    return this.rows.filter(row=>row.status!=='confirmed'&&row.status!=='failed')
      .map(row=>({id:row.id,sequence:row.sequence,code:row.code,sku:row.product?.sku||row.code,
        descripcion:row.product?.descripcion||'',marbete:row.location||null,
        status:row.status,error:row.error||'',capturedAt:row.capturedAt,attempts:row.attempts,
        canSync:Boolean(row.location||row.unlocatedApproved)}));
  }
  finish() {
    if (this.state.pendingSwitch) throw Error('Confirma o cancela el cambio de marbete.');
    if (this.rows.some(row=>row.kind==='receive'&&!row.location&&!row.unlocatedApproved&&row.status==='queued'))
      throw Error('Hay piezas sin ubicación. Escanea su marbete o elige registrar sin ubicación antes de finalizar.');
    this.state.endedAt = new Date(this.now()).toISOString(); this.saveSession(); this.changed();
    return this.report(); // Never dispatch inventory from finalization.
  }
  resume() { this.state.endedAt = null; this.saveSession(); this.changed(); this.schedule(0); }
  newSession() {
    if (this.pending) throw Error('Primero sincroniza las lecturas pendientes.');
    if (this.busy) throw Error('Espera al servidor.');
    this.state = this.empty(); this.rows = []; this.nextSequence = 0; this.cache.clear(); this.saveSession(); this.changed();
  }
  report() {
    const locations = new Map(), active = this.state.candidate || this.state.active;
    let confirmed = 0, failed = 0, pendingCount = 0, net = 0, visit = 0, awaitingLocation=0;
    for (const row of this.rows) {
      if(row.kind==='receive'&&!row.location&&!row.unlocatedApproved&&row.status!=='confirmed')awaitingLocation++;
      const value = locations.get(row.location) || {marbete:row.location,pieces:0,confirmed:0,pending:0,failed:0};
      if (row.status === 'confirmed') {
        const delta = row.kind === 'undo' ? -1 : 1;
        net += delta; confirmed++; value.pieces += delta; value.confirmed++;
        if (row.visitId === active?.visitId) visit += delta;
      } else if (row.status === 'failed') { failed++; value.failed++; }
      else {value.pending++;pendingCount++;}
      locations.set(row.location,value);
    }
    return {sessionId:this.state.id,userId:this.userId,actor:this.actor,deptId:this.deptId,startedAt:this.state.startedAt,
      endedAt:this.state.endedAt,totalPieces:net,visitPieces:visit,locations:[...locations.values()],
      confirmed,pending:pendingCount,awaitingLocation,failed,rows:this.rows};
  }
  async dispose() {
    this.disposed = true; clearTimeout(this.timer); this.timer = null;
    // Keep the lease until all requests that may have committed have been
    // journaled. A reopened tab cannot replay an in-flight row concurrently.
    try { await this.job; } finally { await this.mirror.dispose(); this.release?.(); await this.lease; this.onChange=()=>{}; }
  }
}

export function receiptCsv(report) {
  const cell = value => '"' + String(value ?? '').replace(/^[=+@-]/,"'$&").replace(/"/g,'""') + '"';
  const lines = [
    ['VANTIS','Recepción de mercancía',report.sessionId],['Responsable',report.actor],['Usuario',report.userId],
    ['Inicio',report.startedAt],['Fin',report.endedAt || 'En curso'],['Piezas confirmadas netas',report.totalPieces],
    ['Movimientos confirmados',report.confirmed],['Pendientes',report.pending],['Fallidos',report.failed],[],
    ['Marbete','Piezas netas','Confirmados','Pendientes','Fallidos'],
    ...report.locations.map(row=>[row.marbete||'SIN UBICACIÓN',row.pieces,row.confirmed,row.pending,row.failed]),[],
    ['Movimiento','Tipo','Reversa de','Código leído','SKU','Descripción','Cantidad','Marbete','Estado','Leído','Guardado','Error'],
    ...report.rows.map(row=>[row.id,row.kind,row.reverses,row.code,row.product?.sku,row.product?.descripcion,
      row.kind==='undo'?-1:1,row.location,row.status,row.capturedAt,row.receipt?.stored_at,row.error])
  ];
  return '\uFEFF' + lines.map(line=>line.map(cell).join(',')).join('\r\n');
}
