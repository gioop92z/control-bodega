import {SupportBatch, lookupSupportCodes, cleanSupportCode, MAX_BATCH_ROWS} from './support-batch.mjs?v=3.8.0';

// Capture is synchronous and durable. Catalog reads are batched in the
// background; a slow connection must never hold up the next scanner read.
export class FastExitQueue extends SupportBatch {
  constructor(options) {
    super(options);
    this.accepting = true; this.job = null; this.timer = null;
    this.schedule();
  }
  capture(entries, fingerprint = '') {
    if (!this.accepting || this.busy || this.confirmation || this.stale || this.storageError) throw Error(this.storageError || 'Termina la salida actual o carga el avance guardado antes de seguir escaneando.');
    entries = entries.map(entry => {
      const quantity = Number(entry.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) throw Error('La cantidad debe ser un entero entre 1 y 1,000,000.');
      return {code:cleanSupportCode(entry.code), quantity};
    });
    if (!entries.length) return;
    if (this.state.rows.length && this.state.rows.every(row => row.status === 'done')) {
      const reason = this.state.reason; super.newBatch(); this.state.reason = reason;
    }
    if (fingerprint && this.state.fingerprints.includes(fingerprint)) throw Error('Esta lista ya está en la fila. Para más piezas, vuelve a escanearlas o cambia su cantidad.');
    const rows = structuredClone(this.state.rows);
    for (const entry of entries) {
      const prior = rows.find(row => row.status === 'draft' && (row.code === entry.code || row.resolvedCodes?.includes(entry.code) || row.product?.sku === entry.code));
      if (prior) { prior.quantity += entry.quantity; if (prior.queryFailed) { prior.resolving = true; prior.queryFailed = false; } }
      else rows.push({id:this.uuid(), code:entry.code, quantity:entry.quantity, status:'draft', product:null, locations:[], location:'', resolving:true, lookupError:''});
    }
    if (rows.length > MAX_BATCH_ROWS) throw Error(`Finaliza estas ${MAX_BATCH_ROWS} líneas antes de iniciar las siguientes.`);
    this.state.rows = rows;
    if (fingerprint) this.state.fingerprints.push(fingerprint);
    this.autoLocations();
    this.lastCode = entries.at(-1).code; this.message = `Agregado ${this.lastCode}`;
    this.changed(); this.schedule();
  }
  schedule() {
    if (this.timer || this.job || !this.state.rows.some(row => row.resolving)) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 55);
  }
  flush() {
    if (this.job) return this.job;
    clearTimeout(this.timer); this.timer = null;
    const targets = this.state.rows.filter(row => row.status === 'draft' && row.resolving);
    if (!targets.length) return Promise.resolve();
    this.pending = 1; this.onChange();
    this.job = (async () => {
      try {
        const found = await lookupSupportCodes(this.sb, targets.map(row => row.code), this.deptId);
        for (const target of targets) {
          // Incoming scans replace the array while a lookup is in flight.
          // Apply metadata to the latest row, preserving every captured piece.
          const row = this.state.rows.find(x => x.id === target.id); if (!row) continue;
          const result = found.get(row.code);
          Object.assign(row, result, {resolving:false, queryFailed:false, lookupError:result.error || ''});
          if (result.product) row.resolvedCodes = [...new Set([...(row.resolvedCodes || []), row.code])];
        }
        this.coalesce(); this.autoLocations();
      } catch (error) {
        for (const target of targets) {
          const row = this.state.rows.find(x => x.id === target.id); if (!row) continue;
          row.resolving = false; row.queryFailed = true; row.lookupError = 'Lectura guardada; no se pudo consultar el catálogo. Se reintentará al finalizar.';
        }
      } finally {
        this.pending = 0; this.job = null; this.changed(); this.schedule();
      }
    })();
    return this.job;
  }
  coalesce() {
    const products = new Map(), rows = [];
    for (const row of this.state.rows) {
      if (row.status !== 'draft' || !row.product) { rows.push(row); continue; }
      const prior = products.get(row.product.id);
      if (!prior) { products.set(row.product.id, row); rows.push(row); continue; }
      prior.quantity += row.quantity;
      prior.resolvedCodes = [...new Set([...(prior.resolvedCodes || []), ...(row.resolvedCodes || []), row.code])];
    }
    this.state.rows = rows;
  }
  autoLocations() {
    for (const row of this.state.rows) {
      if (row.status !== 'draft' || row.manualLocation) continue;
      const loc = row.locations?.length === 1 ? row.locations[0] : null;
      row.location = loc && (loc.cantidad == null || Number(loc.cantidad) >= row.quantity) ? loc.marbete_codigo : '';
    }
  }
  async settle() {
    clearTimeout(this.timer); this.timer = null;
    while (this.job || this.state.rows.some(row => row.resolving)) await (this.job || this.flush());
  }
  async refresh() {
    await super.refresh(); this.coalesce(); this.autoLocations();
  }
  async prepare() {
    if (!this.accepting || this.busy) return;
    this.accepting = false;
    try { await this.settle(); await super.review(); }
    catch (error) { this.accepting = true; throw error; }
  }
  resume() { if (!this.busy) { this.confirmation = null; this.accepting = true; this.onChange(); } }
  edit(id, field, value, notify = true) {
    super.edit(id, field, value, false);
    const row = this.state.rows.find(x => x.id === id);
    if (row && field === 'location') row.manualLocation = true;
    this.autoLocations(); if (notify) this.changed(); else this.persist();
  }
  async assign(...args) {
    await super.assign(...args);
    const row = this.state.rows.find(x => x.id === args[0]); if (row) row.manualLocation = true;
    this.changed();
  }
  async submit(options) { try { await super.submit(options); } finally { this.accepting = true; } }
  sync() { super.sync(); this.schedule(); }
}
