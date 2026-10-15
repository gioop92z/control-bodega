import {FastExitQueue} from './exit-queue.mjs?v=3.8.0';
import {lookupSupportCodes, cleanSupportCode, MAX_BATCH_ROWS} from './support-batch.mjs?v=3.8.0';
import {getMarbete, registerMarbete, normalizeMarbete, locationQuery} from './product-location.mjs?v=3.6.0';

const validQty = value => Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 1000000;
const safeMessage = error => String(error?.message || error || 'Error desconocido');
const explicitRejection = error => /^(22|23|42|P0001|PGRST[12])/.test(String(error?.code || ''));

export class ReceiveQueue extends FastExitQueue {
  constructor(options) {
    super(options);
    // Use a separate journal; never mix outgoing and incoming movements.
    clearTimeout(this.timer); this.timer = null;
    this.key = 'vantis.receiving.v1:' + this.userId + ':' + this.deptId + ':' + this.actor;
    this.stale = false; this.storageError = ''; this.confirmation = null;
    this.state = this.read() || this.empty();
    for (const row of this.state.rows) if (row.status === 'sending') row.status = 'uncertain';
    this.accepting = true; this.activeValidated = !this.state.activeMarbete; this.selecting = false;
    this.schedule();
  }

  empty() {
    return {...super.empty(), activeMarbete:'', locationLabel:''};
  }

  autoLocations() {
    // Never infer a shelf. A location is optional; an explicit physical
    // marbete still belongs to each captured row and is not reassigned.
  }

  coalesce() {
    const merged = new Map(), out = [];
    for (const row of this.state.rows) {
      if (row.status !== 'draft' || !row.product) { out.push(row); continue; }
      const key = row.product.id + '\u0000' + row.location;
      const prior = merged.get(key);
      if (!prior) { merged.set(key,row); out.push(row); continue; }
      prior.quantity += row.quantity;
      prior.resolvedCodes = [...new Set([...(prior.resolvedCodes || []), ...(row.resolvedCodes || []), row.code])];
    }
    this.state.rows = out;
  }

  async selectMarbete(raw) {
    if (this.busy || !this.accepting || this.confirmation || this.stale || this.storageError) throw Error('Termina o recupera esta recepción antes de cambiar el marbete.');
    const previous = {
      code:this.state.activeMarbete,
      label:this.state.locationLabel,
      validated:this.activeValidated
    };
    this.selecting = true; this.activeValidated = false; this.onChange();
    try {
      const code = normalizeMarbete(raw).toUpperCase();
      let marbete, created = false;
      try {
        marbete = await getMarbete(this.sb, code, this.deptId);
      } catch (error) {
        if (error?.code !== 'NOT_REGISTERED') throw error;
        // Auto-create only our issued bodega labels. Never mistake a SKU/UPC
        // for a new location, nor overwrite a label from another department.
        if (!/^ZAP-(?:402|459|405)-\d{3,4}$/.test(code)) {
          throw Error('El código no es un marbete de zapatería válido. Revisa la etiqueta.');
        }
        marbete = await registerMarbete(this.sb, {
          code,deptId:this.deptId,zona:'BODEGA'
        });
        created = true;
      }
      this.state.activeMarbete = marbete.codigo;
      this.state.locationLabel = [marbete.zona,marbete.descripcion].filter(Boolean).join(' · ');
      if (!this.persist()) throw Error(this.storageError || this.message);
      this.activeValidated = true;
      this.message = created ? '✓ Marbete ' + marbete.codigo + ' registrado y seleccionado.' : '✓ Marbete ' + marbete.codigo + ' seleccionado.';
      this.onChange();
      return {...marbete,created};
    } catch(error) {
      this.state.activeMarbete = previous.code;
      this.state.locationLabel = previous.label;
      this.activeValidated = previous.validated;
      this.onChange();
      throw error;
    } finally { this.selecting = false; this.onChange(); }
  }

  useWithoutLocation() {
    if (this.busy || !this.accepting || this.confirmation || this.stale || this.storageError) throw Error('Espera a terminar esta recepción.');
    this.state.activeMarbete = '';
    this.state.locationLabel = '';
    this.activeValidated = true;
    this.message = '';
    if (!this.persist()) throw Error(this.storageError || this.message);
    this.onChange();
  }

  async validateActive() {
    if (!this.state.activeMarbete) return;
    this.activeValidated = false;
    try {
      await this.selectMarbete(this.state.activeMarbete);
    } catch (error) {
      this.activeValidated = false;
      this.message = 'Vuelve a escanear un marbete vigente: ' + safeMessage(error);
      this.onChange();
    }
  }

  capture(entries, fingerprint = '') {
    if ((this.state.activeMarbete && !this.activeValidated) || this.selecting) throw Error('Espera a que termine la validación del marbete.');
    if (!this.accepting || this.busy || this.confirmation || this.stale || this.storageError) throw Error(this.storageError || 'Termina o recupera la recepción antes de escanear más piezas.');
    entries = entries.map(entry => {
      const code = cleanSupportCode(entry.code), quantity = Number(entry.quantity);
      if (!validQty(quantity)) throw Error('La cantidad debe ser un número entero positivo.');
      return {code,quantity};
    });
    if (!entries.length) return;
    if (this.state.rows.length && this.state.rows.every(row => row.status === 'done')) {
      const active = this.state.activeMarbete, label = this.state.locationLabel;
      this.newBatch(); this.state.activeMarbete = active; this.state.locationLabel = label;
      this.persist();
    }
    const sameList = fingerprint && this.state.fingerprints.includes((this.state.activeMarbete || 'SIN-UBICACION') + ':' + fingerprint);
    if (sameList) throw Error('Esta lista ya fue agregada al marbete activo. No se duplicó.');
    const rows = structuredClone(this.state.rows);
    for (const entry of entries) {
      const prior = rows.find(row => row.status === 'draft' && row.location === this.state.activeMarbete &&
        (row.code === entry.code || row.resolvedCodes?.includes(entry.code) || row.product?.sku === entry.code));
      if (prior) {
        if (!validQty(prior.quantity + entry.quantity)) throw Error('Cantidad máxima por artículo excedida.');
        prior.quantity += entry.quantity;
        if (prior.queryFailed) {prior.resolving=true;prior.queryFailed=false;}
      } else {
        rows.push({id:this.uuid(),code:entry.code,quantity:entry.quantity,status:'draft',product:null,
          locations:[],location:this.state.activeMarbete,manualLocation:true,resolving:true,lookupError:''});
      }
    }
    if (rows.length > MAX_BATCH_ROWS) throw Error('La fila admite hasta ' + MAX_BATCH_ROWS + ' grupos de SKU y ubicación. Finaliza esta recepción para continuar.');
    this.state.rows = rows;
    if (fingerprint) this.state.fingerprints.push((this.state.activeMarbete || 'SIN-UBICACION') + ':' + fingerprint);
    this.lastCode = entries.at(-1).code; this.message = 'Capturado ' + this.lastCode;
    this.changed(); this.schedule();
    if (this.storageError || this.stale) throw Error(this.storageError || this.message);
  }

  async refresh() {
    const rows = this.state.rows.filter(row => row.status === 'draft');
    if (!rows.length) return;
    const found = await lookupSupportCodes(this.sb, rows.map(row => row.code), this.deptId);
    for (const row of rows) {
      const result = found.get(row.code);
      Object.assign(row,result,{lookupError:result?.error || '',saveError:''});
      // Never clear the physically scanned location, even when the SKU has
      // not previously been associated with that marbete.
    }
    this.coalesce();
  }

  async prepare() {
    if (!this.accepting || this.busy || this.stale || this.storageError) return;
    this.accepting = false;
    try {
      await this.settle();
      if (!this.online()) throw Error('Sin conexión. El borrador se conserva; vuelve a finalizar cuando tengas internet.');
      if (this.state.rows.some(row => row.status === 'sending' || row.status === 'uncertain')) throw Error('Hay entradas por verificar. Revísalas antes de continuar.');
      this.busy = true; this.onChange();
      try {
        await this.refresh();
        const draft = this.state.rows.filter(row => row.status === 'draft');
        if (!draft.length) throw Error('Escanea al menos una pieza.');
        const codes = [...new Set(draft.map(row => row.location).filter(Boolean))];
        await Promise.all(codes.map(code => getMarbete(this.sb, code, this.deptId)));
        let issues = 0;
        for (const row of draft) {
          const p = row.product;
          const problem = !validQty(row.quantity) ? 'Cantidad no válida.'
            : !p || !p.activo || p.departamento_id !== this.deptId ? row.lookupError || 'Producto no encontrado en este departamento.'
             : '';
          row.saveError = problem;
          if (problem) issues++;
        }
        this.changed();
        if (issues) throw Error(issues + ' artículo(s) requieren revisión. Las demás lecturas siguen guardadas.');
        this.confirmation = {rows:draft.length,pieces:draft.reduce((sum,row)=>sum+row.quantity,0),locations:codes.length};
      } finally {this.busy=false;this.onChange();}
    } catch(error) {this.accepting=true;throw error;}
  }

  resume() {
    if (!this.busy) {this.confirmation=null;this.accepting=true;this.onChange();}
  }

  async reconcileRow(row) {
    const p = row.operation?.payload;
    const move = await locationQuery(this.sb.from('movimientos')
      .select('id,tipo,sku,cantidad,departamento_id,marbete_codigo,stock_resultante')
      .eq('id',p.p_id).eq('departamento_id',this.deptId).maybeSingle());
    const same = move?.id === p.p_id && move.tipo === 'ENTRADA' &&
      move.sku === row.product?.sku && Number(move.cantidad) === p.p_cantidad &&
      (move.marbete_codigo || null) === (p.p_marbete || null) && move.departamento_id === this.deptId;
    if (same) {
      row.status='done';row.saveError='';row.product.stock=move.stock_resultante ?? null;
      return true;
    }
    row.status='uncertain';
    row.saveError='No hay confirmación en el historial. NO vuelvas a escanear esta pieza hasta verificar el registro.';
    return false;
  }

  async submit() {
    if (this.busy || !this.confirmation) return;
    if (!this.online()) throw Error('Sin conexión. Se conserva la recepción para reanudar.');
    if (!this.actor && !String(this.state.note || '').trim()) throw Error('Identifica al responsable en la nota.');
    if (!this.locks?.request) throw Error('Se requiere navegador actualizado con bloqueo entre pestañas.');
    this.busy=true;this.onChange();
    try {
      await this.locks.request(this.key,{ifAvailable:true}, async lock => {
        if (!lock) throw Error('Otra pestaña está registrando esta recepción.');
        if (!this.persist()) throw Error(this.storageError || this.message);
        // Create only missing SKU+marbete assignments. A single grouped UPSERT
        // is far faster than opening one product-location screen per piece.
        // Ignore conflicts to NEVER overwrite a quantity counted elsewhere.
        const missing = this.state.rows.filter(row => row.status === 'draft' && row.location &&
          !(row.locations || []).some(loc => loc.marbete_codigo === row.location));
        for (let offset=0; offset<missing.length; offset+=75) {
          const entries=missing.slice(offset,offset+75).map(row=>({
            sku:row.product.sku,marbete_codigo:row.location,cantidad:null,
            updated_at:new Date().toISOString()
          }));
          await locationQuery(this.sb.from('producto_marbetes')
            .upsert(entries,{onConflict:'sku,marbete_codigo',ignoreDuplicates:true}));
        }
        for (const row of this.state.rows.filter(row => row.status === 'draft')) {
          if (!this.online()) throw Error('Se perdió la conexión. El avance quedó guardado.');
          if (row.saveError || !row.product) throw Error(row.saveError || 'Artículo incompleto.');
          row.operation = {payload:{
            p_token:null,p_id:this.uuid(),p_producto:row.product.id,p_tipo:'ENTRADA',
            p_cantidad:row.quantity,p_marbete:row.location || null,
            p_nota:'RECEPCIÓN FÍSICA · Lote ' + this.state.id +
              (this.actor ? ' · ' + this.actor : '') +
              (this.state.note ? ' · ' + this.state.note : '') +
              (!row.location ? ' · SIN UBICACIÓN / PENDIENTE DE ACOMODO' : '')
          }};
          row.status='sending';
          if (!this.persist()) {row.status='draft';row.operation=null;throw Error(this.storageError || this.message);}
          this.onChange();
          try {
            const result = await locationQuery(this.sb.rpc('mover_stock_v2',row.operation.payload));
            row.status='done';row.saveError='';
            const value = Array.isArray(result) ? result[0] : result;
            row.product.stock=value?.stock_resultante ?? null;
            this.changed();
          } catch(error) {
            if (explicitRejection(error)) {
              row.status='draft';row.operation=null;row.saveError=safeMessage(error);this.changed();
              throw Error('No se registró el SKU ' + row.product.sku + ': ' + safeMessage(error));
            }
            row.status='uncertain';
            row.saveError='Confirmación incierta. No reenvíes la entrada sin verificar.';
            this.changed();
            try {await this.reconcileRow(row);} catch {}
            this.changed();
            if (row.status!=='done') throw Error(row.saveError);
          }
        }
        this.message='Recepción registrada. Los grupos sin marbete conservaron ubicación pendiente.';
      });
    } finally {this.busy=false;this.changed();this.accepting=true;}
  }
}
