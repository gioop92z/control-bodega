import {locationQuery, assignProductLocation, registerMarbete} from './product-location.mjs?v=3.6.0';

export const MAX_BATCH_ROWS = 500;
const MAX_QTY = 1000000;
const COLS = 'id,sku,upc,descripcion,marca,talla,color,stock,departamento_id,activo';
const clean = value => String(value ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
const heading = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const codeHeaders = ['sku','upc','ean','codigo','codigodebarras','articulo','codigoarticulo'];
const qtyHeaders = ['cantidad','piezas','unidades','qty','quantity','cant'];

export function cleanSupportCode(value) {
  let code = clean(value).replace(/^=['"](.*)['"]$/, '$1').replace(/^['’]+|['’]+$/g, '');
  if (!code || code.length > 120 || /[\s\x00-\x1F\x7F]/.test(code)) throw Error('Usa un SKU o UPC completo, sin espacios ni descripciones.');
  if (/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(code) || /^\d+[.,]\d+$/.test(code)) throw Error('El código está redondeado o en notación científica. Copia la columna como texto.');
  return code;
}

function quantity(value) {
  const text = clean(value);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < 1 || Number(text) > MAX_QTY) throw Error('La cantidad debe ser un entero de 1 a 1,000,000.');
  return Number(text);
}

// Preserve quoted CSV fields, Excel leading zeroes and physical source lines.
function delimited(text, separator) {
  const rows = []; let cells = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && (quoted || cell === '' || cell === '=')) {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else { quoted = !quoted; if (cell === '=') cell = ''; }
    } else if (!quoted && (c === separator || c === '\n')) {
      cells.push(cell); cell = '';
      if (c === '\n') { rows.push(cells); cells = []; }
    } else if (c !== '\r' || quoted) cell += c;
  }
  if (quoted) throw Error('Hay comillas sin cerrar en el texto pegado.');
  cells.push(cell); rows.push(cells);
  return rows.filter(row => row.some(value => clean(value)));
}

export function parseSupportText(raw, options = {}) {
  const text = clean(raw).replace(/\r\n?/g, '\n');
  if (!text) throw Error('Pega al menos un SKU o UPC.');
  if (text.length > 300000) throw Error('El texto es demasiado grande. Divide el reporte en lotes.');
  const separator = text.includes('\t') ? '\t' : (text.includes(';') ? ';' : ',');
  let rows = delimited(text, separator);
  const first = rows[0].map(heading);
  const detectedCode = codeHeaders.map(name => first.indexOf(name)).find(index => index >= 0) ?? -1;
  const table = options.mode === 'table' || (options.mode !== 'list' && (separator === '\t' || detectedCode >= 0));
  const hasHeader = table && (options.hasHeader ?? detectedCode >= 0);
  const columns = table ? Array.from({length:Math.max(...rows.map(row => row.length))}, (_, i) => hasHeader ? clean(rows[0][i]) || `Columna ${i + 1}` : `Columna ${i + 1}`) : ['SKU / UPC'];
  const codeColumn = Number(options.codeColumn ?? (detectedCode >= 0 ? detectedCode : 0));
  const detectedQty = hasHeader ? first.findIndex(name => qtyHeaders.includes(name)) : -1;
  const quantityColumn = Number(options.quantityColumn ?? detectedQty);
  if (table && codeColumn === quantityColumn) throw Error('Elige columnas diferentes para el código y la cantidad.');
  if (hasHeader) rows = rows.slice(1);
  if (!table) rows = text.split(/[\s,;]+/).filter(Boolean).map(code => [code]);
  if (!rows.length) throw Error('El reporte no contiene artículos.');
  if (rows.length > MAX_BATCH_ROWS) throw Error(`Agrega como máximo ${MAX_BATCH_ROWS} renglones a la vez.`);
  const entries = [], errors = [];
  rows.forEach((row, index) => {
    try {
      const code = cleanSupportCode(row[table ? codeColumn : 0]);
      const qty = table && quantityColumn >= 0 ? quantity(row[quantityColumn]) : 1;
      entries.push({code, quantity:qty});
    } catch (error) { errors.push(`Fila ${index + (hasHeader ? 2 : 1)}: ${error.message}`); }
  });
  return {entries, errors, columns, codeColumn, quantityColumn, hasHeader, table, preview:rows.slice(0, 4), fingerprint:JSON.stringify(entries)};
}

export function codeVariants(code) {
  const compact = code.replace(/-/g, '');
  const upc = new Set([compact]);
  if (/^\d+$/.test(compact)) {
    const stripped = compact.replace(/^0+(?=\d)/, ''); upc.add(stripped);
    if (stripped.length >= 10 && stripped.length <= 14) for (const size of [11,12,13,14]) if (stripped.length <= size) upc.add(stripped.padStart(size, '0'));
  }
  return {sku:[code], upc:[...upc]};
}

async function pages(makeQuery) {
  const out = [], size = 500;
  for (let offset = 0; ; offset += size) {
    const rows = await locationQuery(makeQuery().range(offset, offset + size - 1));
    out.push(...(rows || []));
    if ((rows || []).length < size) return out;
  }
}
async function chunks(values, makeQuery) {
  const out = [];
  for (let i = 0; i < values.length; i += 50) out.push(...await pages(() => makeQuery(values.slice(i, i + 50))));
  return out;
}

export async function lookupSupportCodes(sb, codes, deptId) {
  const unique = [...new Set(codes.map(cleanSupportCode))];
  const variants = new Map(unique.map(code => [code, codeVariants(code)]));
  const skus = [...new Set([...variants.values()].flatMap(x => x.sku))];
  const upcs = [...new Set([...variants.values()].flatMap(x => x.upc))];
  const query = (field, values) => sb.from('productos').select(COLS).eq('departamento_id', deptId).eq('activo', true).in(field, values).order('id');
  const [bySku, byUpc] = await Promise.all([chunks(skus, values => query('sku', values)), chunks(upcs, values => query('upc', values))]);
  const products = new Map([...bySku, ...byUpc].map(row => [row.id, row]));
  const found = new Map();
  for (const [code, choices] of variants) {
    let matches = [...products.values()].filter(p => p.sku === code);
    if (!matches.length) matches = [...products.values()].filter(p => choices.upc.includes(String(p.upc)));
    found.set(code, matches.length === 1 ? {product:matches[0], locations:[]} : {product:null, locations:[], error:matches.length ? 'UPC ambiguo: usa el SKU exacto de la variante.' : 'No encontrado en este departamento. Revisa el código o el catálogo.'});
  }
  const productSkus = [...new Set([...found.values()].filter(x => x.product).map(x => x.product.sku))];
  const locations = await chunks(productSkus, values => sb.from('producto_marbetes').select('sku,marbete_codigo,cantidad,marbetes(zona,descripcion,activo,departamento_id)').in('sku', values).order('sku').order('marbete_codigo'));
  for (const result of found.values()) if (result.product) result.locations = locations.filter(x => x.sku === result.product.sku && x.marbetes?.activo === true && x.marbetes?.departamento_id === deptId).map(x => ({marbete_codigo:x.marbete_codigo, cantidad:x.cantidad, zona:x.marbetes.zona, descripcion:x.marbetes.descripcion}));
  return found;
}

export function lineIssue(row, deptId) {
  if (row.status === 'done') return '';
  if (row.status === 'sending' || row.status === 'uncertain') return 'Hay una salida por verificar. No vuelvas a capturar esta pieza.';
  try { quantity(row.quantity); } catch (error) { return error.message; }
  const p = row.product;
  if (!p || p.activo !== true || p.departamento_id !== deptId) return row.lookupError || 'Vuelve a consultar este artículo.';
  if (!Number.isSafeInteger(Number(p.stock)) || Number(p.stock) < row.quantity) return `Existencia insuficiente: ${p.stock ?? 'sin dato'}; solicitadas ${row.quantity}.`;
  const loc = row.locations?.find(x => x.marbete_codigo === row.location);
  if (row.location && !loc) return 'La ubicación dejó de estar disponible. Elige otra.';
  if (loc?.cantidad != null && (!Number.isSafeInteger(Number(loc.cantidad)) || Number(loc.cantidad) < row.quantity)) return `El marbete ${loc.marbete_codigo} solo tiene ${loc.cantidad} piezas contadas. Elige otro o revisa el conteo.`;
  return '';
}

export function movementMatches(row, move, deptId) {
  const p = row.operation?.payload;
  return !!p && move?.id === p.p_id && move.tipo === 'SALIDA' && move.departamento_id === deptId && move.sku === row.product?.sku && Number(move.cantidad) === p.p_cantidad && (move.marbete_codigo || null) === p.p_marbete;
}

export class SupportBatch {
  constructor({sb, deptId, userId, actor, storage, uuid, online = () => navigator.onLine, locks = globalThis.navigator?.locks, onChange = () => {}}) {
    Object.assign(this, {sb, deptId, userId, actor, storage, uuid, online, locks, onChange});
    this.key = `vantis.supports.v1:${userId}:${deptId}:${actor}`;
    this.busy = false; this.pending = 0; this.tail = Promise.resolve(); this.confirmation = null; this.message = ''; this.storageError = ''; this.stale = false;
    this.state = this.read() || this.empty();
    for (const row of this.state.rows) if (row.status === 'sending') row.status = 'uncertain';
  }
  empty() { return {version:1, id:this.uuid(), deptId:this.deptId, userId:this.userId, actor:this.actor, revision:0, rows:[], fingerprints:[], note:''}; }
  read() {
    try {
      const value = this.storage.getItem(this.key);
      if (!value) return null;
      const data = JSON.parse(value);
      if (data.version !== 1 || data.deptId !== this.deptId || data.userId !== this.userId || data.actor !== this.actor || !Array.isArray(data.rows) || data.rows.length > MAX_BATCH_ROWS || !Array.isArray(data.fingerprints) || !Number.isSafeInteger(data.revision)) throw Error('invalid draft');
      for (const row of data.rows) if (!row.id || !['draft','sending','uncertain','done'].includes(row.status) || !row.code || (['sending','uncertain','done'].includes(row.status) && !row.operation?.payload)) throw Error('invalid row');
      return data;
    } catch { this.storageError = 'No pude leer el borrador guardado. Conserva esta pestaña y revisa el almacenamiento del navegador.'; return null; }
  }
  persist() {
    if (this.storageError || this.stale) return false;
    try {
      const saved = this.read();
      if (this.storageError) return false;
      if (saved && (saved.id !== this.state.id || saved.revision !== this.state.revision)) { this.stale = true; this.message = 'Otra pestaña actualizó este lote. Carga su avance antes de continuar.'; return false; }
      const next = {...this.state, revision:this.state.revision + 1, updatedAt:new Date().toISOString()};
      this.storage.setItem(this.key, JSON.stringify(next)); this.state.revision = next.revision; return true;
    } catch { this.storageError = 'No pude guardar el borrador en este navegador. Libera espacio antes de registrar salidas.'; return false; }
  }
  changed(save = true) { if (save) this.persist(); this.confirmation = null; this.onChange(); }
  sync() {
    if (this.busy || this.pending) return;
    const saved = this.read(); if (saved) this.state = saved;
    for (const row of this.state.rows) if (row.status === 'sending') row.status = 'uncertain';
    this.stale = false; this.message = 'Borrador recuperado. Revisa las salidas por verificar.'; this.changed(false);
  }
  editable() { if (this.busy || this.pending || this.confirmation || this.stale || this.storageError) throw Error('Espera a que termine la operación actual o carga el avance guardado.'); }
  edit(id, field, value, notify = true) {
    this.editable(); const row = this.state.rows.find(x => x.id === id);
    if (!row || row.status !== 'draft') return;
    if (field === 'quantity') row.quantity = quantity(value);
    else if (field === 'location') row.location = value;
    row.saveError = ''; if (notify) this.changed(); else { this.confirmation = null; this.persist(); }
  }
  remove(id) { this.editable(); this.state.rows = this.state.rows.filter(row => row.id !== id || row.status !== 'draft'); this.state.fingerprints = []; this.changed(); }
  setNote(value, notify = true) { this.editable(); this.state.note = String(value).slice(0,500); if (notify) this.changed(); else this.persist(); }
  add(entries, fingerprint = '') {
    if (this.busy || this.confirmation || this.stale || this.storageError) return Promise.reject(Error('Termina la revisión actual antes de agregar más artículos.'));
    entries = entries.map(x => ({code:cleanSupportCode(x.code), quantity:quantity(x.quantity)}));
    this.pending++; this.onChange();
    const task = this.tail.then(async () => {
      if (fingerprint && this.state.fingerprints.includes(fingerprint)) throw Error('Esta lista ya se agregó. Revisa la fila o cambia la cantidad para añadir más piezas.');
      const found = await lookupSupportCodes(this.sb, entries.map(x => x.code), this.deptId);
      const next = structuredClone(this.state.rows);
      for (const entry of entries) {
        const result = found.get(entry.code);
        const prior = next.find(row => row.status === 'draft' && (result.product ? row.product?.id === result.product.id : row.code === entry.code));
        if (prior) { prior.quantity = quantity(prior.quantity + entry.quantity); continue; }
        next.push({id:this.uuid(), code:entry.code, quantity:entry.quantity, ...result, lookupError:result.error || '', location:result.locations.length === 1 ? result.locations[0].marbete_codigo : '', status:'draft'});
      }
      if (next.length > MAX_BATCH_ROWS) throw Error(`El lote admite hasta ${MAX_BATCH_ROWS} artículos. Termina este lote y abre otro.`);
      this.state.rows = next;
      if (fingerprint) this.state.fingerprints.push(fingerprint);
      this.message = `Se agregaron ${entries.reduce((sum, x) => sum + x.quantity, 0)} piezas a la fila.`;
      this.changed();
    }).finally(() => { this.pending--; this.onChange(); });
    this.tail = task.catch(() => {}); return task;
  }
  async refresh() {
    const rows = this.state.rows.filter(row => row.status === 'draft');
    if (!rows.length) return;
    const found = await lookupSupportCodes(this.sb, rows.map(row => row.code), this.deptId);
    for (const row of rows) {
      const result = found.get(row.code);
      Object.assign(row, result, {lookupError:result.error || '', saveError:''});
      if (row.location && !row.locations.some(x => x.marbete_codigo === row.location)) row.location = '';
      if (!row.location && row.locations.length === 1) row.location = row.locations[0].marbete_codigo;
    }
  }
  async review() {
    this.editable(); if (!this.online()) throw Error('Necesitas conexión para revisar y registrar el lote.');
    if (!this.state.rows.some(row => row.status !== 'done')) throw Error('Agrega artículos para abrir un lote.');
    this.busy = true; this.onChange();
    try {
      await this.refresh();
      const issues = this.state.rows.filter(row => lineIssue(row, this.deptId));
      this.changed();
      if (issues.length) throw Error(`Resuelve ${issues.length} fila(s) pendientes antes de confirmar.`);
      const rows = this.state.rows.filter(row => row.status === 'draft');
      this.confirmation = {rows:rows.length, pieces:rows.reduce((sum, row) => sum + row.quantity, 0), totalOnly:rows.filter(row => !row.location || row.locations.find(x => x.marbete_codigo === row.location)?.cantidad == null).length};
    } finally { this.busy = false; this.onChange(); }
  }
  async assign(id, code, registerZone = null, admin = false) {
    this.editable(); if (!this.online()) throw Error('Necesitas conexión para guardar la ubicación.');
    const row = this.state.rows.find(x => x.id === id);
    if (!row?.product || row.status !== 'draft') throw Error('Vuelve a consultar el artículo.');
    if (codeVariants(row.product.sku).sku.includes(clean(code)) || codeVariants(row.product.upc || '').upc.includes(clean(code))) throw Error('Escaneaste el artículo. Escanea el marbete del mueble o cajón.');
    this.busy = true; this.onChange();
    try {
      if (registerZone) {
        if (!admin) throw Error('Solo el administrador puede registrar un marbete nuevo.');
        await registerMarbete(this.sb, {code, deptId:this.deptId, zona:registerZone});
      }
      await assignProductLocation(this.sb, {productId:row.product.id, sku:row.product.sku, deptId:this.deptId, marbeteCode:code});
      const found = await lookupSupportCodes(this.sb, [row.code], this.deptId);
      Object.assign(row, found.get(row.code)); row.location = clean(code);
      this.message = `Ubicación guardada: ${code}. El stock total conserva su cantidad.`; this.changed();
    } finally { this.busy = false; this.onChange(); }
  }
  async reconcileRow(row) {
    const move = await locationQuery(this.sb.from('movimientos').select('id,tipo,sku,cantidad,departamento_id,marbete_codigo,stock_resultante').eq('id', row.operation.payload.p_id).eq('departamento_id', this.deptId).maybeSingle());
    if (movementMatches(row, move, this.deptId)) { row.status = 'done'; row.saveError = ''; row.product.stock = move.stock_resultante ?? null; return true; }
    row.status = 'uncertain'; row.saveError = 'Aún no hay confirmación del movimiento. Conserva esta fila y revisa el historial; no se reenviará automáticamente.'; return false;
  }
  async verify() {
    this.editable(); if (!this.online()) throw Error('Necesitas conexión para verificar las salidas.');
    this.busy = true; this.onChange();
    try {
      for (const row of this.state.rows.filter(x => ['sending','uncertain'].includes(x.status))) {
        try { await this.reconcileRow(row); } catch { row.status = 'uncertain'; row.saveError = 'No pude consultar el movimiento. Vuelve a verificar cuando tengas conexión.'; }
        this.changed();
      }
      this.message = this.state.rows.some(x => x.status === 'uncertain') ? 'Quedan salidas por verificar. Las confirmadas ya están registradas.' : 'Las salidas enviadas quedaron verificadas.';
    } finally { this.busy = false; this.changed(); }
  }
  async submit({acknowledgeTotalOnly = false, reason = 'APOYO INTERNET'} = {}) {
    if (this.busy || !this.confirmation) return;
    if (!this.online()) throw Error('Necesitas conexión para registrar el lote.');
    if (!['APOYO INTERNET','VENTA NOCTURNA','VENTA','OTRA SALIDA'].includes(reason)) throw Error('Elige el motivo de la salida.');
    if (!clean(this.state.note) && !this.actor) throw Error('Identifica tu nombre o número de empleado.');
    if (this.confirmation.totalOnly && !acknowledgeTotalOnly) throw Error('Confirma las filas que descontarán únicamente la existencia total.');
    if (!this.locks?.request) throw Error('Este navegador no permite proteger el lote entre pestañas. Usa una versión actual de Chrome, Edge o Safari.');
    this.busy = true; this.onChange();
    try {
      await this.locks.request(this.key, {ifAvailable:true}, async lock => {
        if (!lock) throw Error('Este lote se está guardando en otra pestaña. Espera y carga su avance.');
        if (!this.persist()) throw Error(this.storageError || this.message);
        for (const row of this.state.rows.filter(x => x.status === 'draft')) {
          const issue = lineIssue(row, this.deptId); if (issue) throw Error(issue);
          if (!this.online()) throw Error('Se interrumpió la conexión. Se conservó el avance del lote.');
          const loc = row.locations.find(x => x.marbete_codigo === row.location);
          const referenceOnly = !!loc && loc.cantidad == null;
          row.operation = {payload:{p_token:null, p_id:this.uuid(), p_producto:row.product.id, p_tipo:'SALIDA', p_cantidad:row.quantity, p_marbete:referenceOnly ? null : row.location || null, p_nota:`${reason} · Lote ${this.state.id} · ${this.actor}${this.state.note ? ' · ' + this.state.note : ''}${referenceOnly ? ' · Marbete de referencia: ' + row.location + ' (sin conteo por ubicación)' : ''}`}};
          row.status = 'sending';
          if (!this.persist()) { row.status = 'draft'; row.operation = null; throw Error(this.storageError || this.message); }
          this.onChange();
          try {
            const receipt = await locationQuery(this.sb.rpc('mover_stock_v2', row.operation.payload));
            const result = Array.isArray(receipt) ? receipt[0] : receipt;
            // An acknowledged RPC response confirms its committed transaction.
            // Only an ambiguous/lost response needs a history read, which also
            // avoids making seller success depend on extra history permissions.
            row.status = 'done'; row.saveError = ''; row.product.stock = result?.stock_resultante ?? null;
            this.changed();
          } catch (error) {
            // Explicit SQL validation/permission errors roll back their transaction.
            // A lost response or unknown server error stays locked until reconciled.
            if (/^(22|23|42|P0001|PGRST[12])/.test(String(error.code || ''))) {
              row.status = 'draft'; row.operation = null; row.saveError = error.message; this.changed();
              throw Error(`La salida de ${row.product.sku} fue rechazada: ${error.message}`);
            }
            row.status = 'uncertain'; row.saveError = 'Se perdió la confirmación. Verifica el avance antes de continuar.'; this.changed();
            try { await this.reconcileRow(row); } catch { /* preserve uncertain */ }
            this.changed(); if (row.status !== 'done') throw Error(row.saveError);
          }
        }
        this.message = 'Lote registrado y verificado. Todas sus salidas quedaron en el historial.';
      });
    } finally { this.busy = false; this.changed(); }
  }
  newBatch() {
    this.editable(); if (this.state.rows.some(row => row.status !== 'done')) throw Error('Termina o retira las filas pendientes antes de abrir otro lote.');
    if (!this.persist()) throw Error(this.storageError || this.message);
    const revision = this.state.revision; this.state = {...this.empty(), revision};
    // The revision comparison above prevents replacing another tab's progress.
    const old = this.read(); this.state.revision = (old?.revision || revision) + 1;
    try { this.storage.setItem(this.key, JSON.stringify(this.state)); } catch { this.storageError = 'No pude abrir otro lote. Revisa el almacenamiento.'; }
    this.message = ''; this.changed(false);
  }
}
