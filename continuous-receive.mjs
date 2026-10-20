import {parseMarbeteScan, locationQuery} from './product-location.mjs?v=3.9.5';
import {cleanSupportCode, lookupSupportCodes} from './support-batch.mjs?v=3.8.0';

const message = error => String(error?.message || error || 'No se pudo guardar.');
const permanent = error => /^(22|23|P0001)/.test(String(error?.code || ''));
const missing = error => /PGRST202|42883/.test(String(error?.code || ''));
const uuid = () => crypto.randomUUID();
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
  constructor(sb, deptId) { this.sb = sb; this.deptId = deptId; }
  async capabilities() { return locationQuery(this.sb.rpc('vantis_recepcion_estado_v1', {})); }
  async activate(code) { return locationQuery(this.sb.rpc('vantis_activar_marbete_v1', {p_departamento:this.deptId, p_codigo:code})); }
  lookup(codes) { return lookupSupportCodes(this.sb, codes, this.deptId); }
  async receive(payload) { return locationQuery(this.sb.rpc('vantis_recibir_pieza_v1', payload)); }
}

export class ContinuousReceive {
  constructor({api, storage, userId, deptId, actor, locks = globalThis.navigator?.locks,
    online = () => globalThis.navigator?.onLine !== false, makeId = uuid,
    onChange = () => {}, onConfirmed = () => {}, onFailure = () => {}, now = () => Date.now()}) {
    Object.assign(this, {api, storage, userId, deptId, actor, locks, online, makeId, onChange, onConfirmed, onFailure, now});
    this.journal = new ReceiptJournal(storage, [userId,deptId,encodeURIComponent(actor)].join('/'));
    this.cache = new Map(); this.timer = null; this.job = null; this.owned = false; this.disposed = false;
    this.storageError = ''; this.error = ''; this.backend = 'checking'; this.selecting = false;
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
    try { this.journal.saveSession(this.state); return true; }
    catch { this.storageError = 'Almacenamiento local lleno o no disponible. No escanees más hasta recuperar espacio.'; this.onChange(); return false; }
  }
  saveRow(row) {
    try { this.journal.saveRow(this.state.id,row); return true; }
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
        this.state=saved;this.rows=this.journal.readRows(saved.id);
        for(const row of this.rows){if(row.status==='sending')row.status='uncertain';this.nextSequence=Math.max(this.nextSequence,row.sequence);}
      }
      if(!this.saveSession())return;
    }catch(error){this.storageError='No se pudo recuperar la sesión local: '+message(error);this.changed();return;}
    await this.connect();
  }
  async connect() {
    if (!this.owned || this.disposed || this.storageError) return;
    try {
      if (!this.online()) throw Error('Sin conexión.');
      const result = await this.api.capabilities();
      if (result?.version !== 1 || result?.atomic !== true || result?.idempotent !== true) {
        this.backend = 'invalid'; throw Error('El servidor no confirma el contrato de recepción segura.');
      }
      this.backend = 'ready'; this.error = ''; this.state.backendVersion = 1; this.saveSession();
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
      else { if (this.backend !== 'invalid') this.backend = this.state.backendVersion === 1 ? 'offline' : 'checking'; this.error = message(error); this.schedule(4000); }
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
    if (!location) throw Error('Escanea un marbete para comenzar. Este código no es un marbete válido.');
    const productCode = cleanSupportCode(code), id = eventId || this.makeId();
    if (this.rows.some(row => row.id === id)) return {type:'duplicate-event',id};
    const row = {id,sessionId:this.state.id,sequence:++this.nextSequence,kind:'receive',
      code:productCode,quantity:1,location:location.code,visitId:location.visitId,
      capturedAt:new Date(this.now()).toISOString(),status:'queued',attempts:0,error:'',product:null,payload:null};
    if (!this.saveRow(row)) { this.nextSequence--; throw Error(this.storageError); }
    this.rows.push(row); this.changed(); this.schedule(25); return {type:'piece',id};
  }
  setCandidate(code) {
    this.state.candidate = {code,visitId:this.makeId()};
    if (!this.saveSession()) throw Error(this.storageError);
    this.changed();
    if (this.backend === 'ready') void this.activateCandidate();
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
      const location = await this.api.activate(target.code);
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
          row.status = 'failed'; row.error = this.error; this.saveRow(row); this.onFailure(row);
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
    finally { this.job = null; this.changed(); if (this.pending && !this.disposed) this.schedule(this.backend === 'ready' ? 1000 : 4000); }
  }
  async process() {
    if (this.state.candidate) { await this.activateCandidate(); if (this.state.candidate) return; }
    while (!this.disposed && !this.storageError && this.backend === 'ready' && this.online()) {
      const candidates = this.rows.filter(row => ['queued','uncertain'].includes(row.status) && (!row.retryAt || row.retryAt <= this.now()) && row.visitId !== this.state.candidate?.visitId).slice(0,75);
      if (!candidates.length) break;
      const unresolved = candidates.filter(row => !row.payload && !row.product && row.kind === 'receive');
      try {
        const codes = [...new Set(unresolved.map(row => row.code))].filter(code => !this.cache.has(code));
        if (codes.length) for (const [code,result] of await this.api.lookup(codes)) if (result.product) this.cache.set(code,result.product);
        for (const row of unresolved) {
          row.product = this.cache.get(row.code) || null;
          if (!row.product || row.product.departamento_id !== this.deptId || !row.product.activo) {
            row.status = 'failed'; row.error = 'Artículo no encontrado o ambiguo en este departamento. No se registró stock.';
            this.saveRow(row); this.onFailure(row);
          }
        }
      } catch (error) { this.backend = 'offline'; this.error = 'Lecturas protegidas; catálogo pendiente: ' + message(error); break; }
      // Four requests can be in flight; each transaction locks its product on
      // the server. Input capture remains independent of network latency.
      const ready = candidates.filter(row => row.status !== 'failed');
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
    row.status = 'sending'; row.attempts++;
    if (!this.saveRow(row)) return;
    this.changed();
    try {
      const reply = await this.api.receive(structuredClone(row.payload));
      if (reply?.id !== row.id || reply.session_id !== this.state.id || reply.user_id !== this.userId ||
        reply.product_id !== row.product.id || reply.sku !== row.product.sku || reply.marbete_codigo !== row.location ||
        reply.kind !== row.kind || reply.quantity !== 1 || !Number.isFinite(Date.parse(reply.stored_at)) || reply.stock_resultante == null || !Number.isSafeInteger(Number(reply.stock_resultante))) {
        this.backend = 'invalid'; throw Error('Respuesta de almacenamiento incompleta. Esta lectura queda por verificar.');
      }
      row.status = 'confirmed'; row.receipt = reply; row.error = ''; delete row.retryAt;
      this.saveRow(row); this.onConfirmed(row);
    } catch (error) {
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
    if (!this.canScan) throw Error('Reanuda la recepción antes de deshacer.');
    const reversed = new Set(this.rows.filter(row => row.kind === 'undo' && row.status !== 'failed').map(row => row.reverses));
    const original = [...this.rows].reverse().find(row => row.kind === 'receive' && row.status === 'confirmed' && !reversed.has(row.id));
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
    for (const row of this.rows) if (row.status === 'uncertain') row.retryAt = 0;
    await this.connect(); await this.flush();
  }
  finish() {
    if (this.state.pendingSwitch) throw Error('Confirma o cancela el cambio de marbete.');
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
    let confirmed = 0, failed = 0, net = 0, visit = 0;
    for (const row of this.rows) {
      const value = locations.get(row.location) || {marbete:row.location,pieces:0,confirmed:0,pending:0,failed:0};
      if (row.status === 'confirmed') {
        const delta = row.kind === 'undo' ? -1 : 1;
        net += delta; confirmed++; value.pieces += delta; value.confirmed++;
        if (row.visitId === active?.visitId) visit += delta;
      } else if (row.status === 'failed') { failed++; value.failed++; }
      else value.pending++;
      locations.set(row.location,value);
    }
    return {sessionId:this.state.id,userId:this.userId,actor:this.actor,deptId:this.deptId,startedAt:this.state.startedAt,
      endedAt:this.state.endedAt,totalPieces:net,visitPieces:visit,locations:[...locations.values()],
      confirmed,pending:this.pending,failed,rows:this.rows};
  }
  async dispose() {
    this.disposed = true; clearTimeout(this.timer); this.timer = null;
    // Keep the lease until all requests that may have committed have been
    // journaled. A reopened tab cannot replay an in-flight row concurrently.
    try { await this.job; } finally { this.release?.(); await this.lease; this.onChange=()=>{}; }
  }
}

export function receiptCsv(report) {
  const cell = value => '"' + String(value ?? '').replace(/^[=+@-]/,"'$&").replace(/"/g,'""') + '"';
  const lines = [
    ['VANTIS','Recepción masiva',report.sessionId],['Responsable',report.actor],['Usuario',report.userId],
    ['Inicio',report.startedAt],['Fin',report.endedAt || 'En curso'],['Piezas confirmadas netas',report.totalPieces],
    ['Movimientos confirmados',report.confirmed],['Pendientes',report.pending],['Fallidos',report.failed],[],
    ['Marbete','Piezas netas','Confirmados','Pendientes','Fallidos'],
    ...report.locations.map(row=>[row.marbete,row.pieces,row.confirmed,row.pending,row.failed]),[],
    ['Movimiento','Tipo','Reversa de','Código leído','SKU','Descripción','Cantidad','Marbete','Estado','Leído','Guardado','Error'],
    ...report.rows.map(row=>[row.id,row.kind,row.reverses,row.code,row.product?.sku,row.product?.descripcion,
      row.kind==='undo'?-1:1,row.location,row.status,row.capturedAt,row.receipt?.stored_at,row.error])
  ];
  return '\uFEFF' + lines.map(line=>line.map(cell).join(',')).join('\r\n');
}
