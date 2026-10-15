import {parseSupportText, lineIssue} from './support-batch.mjs?v=3.7.0';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function mountSupportBatch(root, batch, {startScanner, stopScanner, admin = false, isCurrent = () => true}) {
  const ui = {text:'', scanText:'', pasteOpen:batch.state.rows.length===0, mode:'auto', parsed:null, options:{}, error:'', openRow:'', marbete:'', rowError:'', missing:false, sort:'capture', acknowledge:false};
  const $ = id => root.querySelector(`#${id}`);
  const active = () => root.isConnected && isCurrent();
  const run = async action => { ui.error = ''; try { await action(); } catch (error) { ui.error = error.message || 'No se pudo completar la operación.'; } paint(); };
  const locked = () => batch.busy || batch.pending > 0 || !!batch.confirmation || batch.stale || !!batch.storageError;
  const status = row => row.status === 'done' ? 'Guardada' : row.status === 'sending' ? 'Guardando…' : row.status === 'uncertain' ? 'Por verificar' : lineIssue(row, batch.deptId) ? 'Revisar' : 'Lista';
  const disable = value => value ? 'disabled' : '';
  function parse() {
    ui.parsed = parseSupportText(ui.text, {...ui.options, mode:ui.mode}); ui.error = '';
  }
  function rowHTML(row, index) {
    const p = row.product, issue = lineIssue(row, batch.deptId), frozen = locked() || row.status !== 'draft';
    const locs = row.locations || [], chosen = locs.find(x => x.marbete_codigo === row.location);
    return `<article class="support-row ${row.status === 'done' ? 'support-done' : ''}" data-support-row="${esc(row.id)}">
      <div class="support-product"><span class="tiny">${index + 1} · SKU ${esc(p?.sku || row.code)}${p?.upc ? ' · UPC ' + esc(p.upc) : ''}</span><strong title="${esc(p?.descripcion)}">${esc(p?.descripcion || 'Código pendiente')}</strong><span class="tiny">${esc(p ? [p.marca,p.talla,p.color].filter(Boolean).join(' · ') : row.lookupError)}${p ? ` · ${row.status==='done'?'Stock final':'Existencia'}: ${esc(p.stock ?? 'actualizado')}` : ''}</span></div>
      <label class="support-qty">Piezas<input type="number" min="1" max="1000000" step="1" inputmode="numeric" value="${row.quantity}" data-support-qty="${esc(row.id)}" aria-label="Cantidad de ${esc(p?.sku || row.code)}" ${disable(frozen)}></label>
      <div class="support-location"><span class="support-badge ${locs.length ? 'located' : 'unlocated'}">${locs.length ? `${locs.length} marbete${locs.length === 1 ? '' : 's'}` : 'Sin marbete'}</span>${row.status === 'draft' ? `<select data-support-location="${esc(row.id)}" aria-label="Ubicación de ${esc(p?.sku || row.code)}" ${disable(frozen || !locs.length)}><option value="">Sin ubicación específica</option>${locs.map(loc => `<option value="${esc(loc.marbete_codigo)}" ${row.location === loc.marbete_codigo ? 'selected' : ''}>${esc(loc.marbete_codigo)} · ${loc.cantidad == null ? 'sin conteo' : esc(loc.cantidad) + ' pzas'} · ${esc(loc.zona)}</option>`).join('')}</select><button type="button" class="support-link" data-support-assign="${esc(row.id)}" ${disable(frozen || !p)}>${locs.length ? 'Agregar marbete' : 'Darle ubicación'}</button>` : `<strong class="tiny">${esc(row.location || 'Sin ubicación específica')}</strong>`}${chosen?.cantidad == null && row.location && row.status === 'draft' ? '<small>Marbete de referencia; descontará el stock total.</small>' : ''}</div>
      <div class="support-row-actions"><span class="support-status ${row.status === 'done' ? 'ok' : issue ? 'warn' : ''}" role="status">${esc(status(row))}</span>${row.status === 'draft' ? `<button type="button" class="support-link" data-support-remove="${esc(row.id)}" ${disable(locked())} aria-label="Retirar ${esc(p?.sku || row.code)} de la fila">Retirar</button>` : ''}</div>
      ${row.status !== 'done' && (issue || row.saveError) ? `<p class="support-row-error">${esc(row.saveError || issue)}</p>` : ''}
      ${ui.openRow === row.id && row.status === 'draft' ? `<div class="support-location-editor"><b>Ubicación para SKU ${esc(p.sku)}</b><p class="tiny">Escanea o escribe el marbete de su mueble. Las ubicaciones existentes se conservan.</p><form id="supportLocationForm" class="inline-form"><input id="supportMarbeteCode" aria-label="Marbete para este artículo" maxlength="120" placeholder="Ej. ZAP-459-001" value="${esc(ui.marbete)}" autocomplete="off" ${disable(locked())}><button type="submit" class="secondary" ${disable(locked())}>Guardar ubicación</button></form><div class="quick-row"><button type="button" id="supportScanMarbete" class="secondary" ${disable(locked())}>Escanear marbete</button><button type="button" id="supportCloseLocation" class="ghost" ${disable(locked())}>Cerrar</button></div>${ui.rowError ? `<div class="error" role="alert">${esc(ui.rowError)}</div>` : ''}${ui.missing ? admin ? `<div class="notice"><b>Marbete nuevo</b><p>Comprueba que ${esc(ui.marbete)} corresponde a un mueble de este departamento.</p><label for="supportNewZone">Tipo de ubicación</label><select id="supportNewZone" ${disable(locked())}><option value="BODEGA">BODEGA</option><option value="PISO">PISO</option></select><button id="supportRegisterMarbete" type="button" class="secondary" ${disable(locked())}>Registrar y asignar marbete</button></div>` : '<p class="notice">Pide al administrador que registre este marbete en Ajustes → Ubicaciones.</p>' : ''}</div>` : ''}
    </article>`;
  }
  function pastePreview() {
    const parsed = ui.parsed; if (!parsed) return '';
    return `<div class="support-preview">${parsed.table ? `<div class="two"><label>Columna de SKU / UPC<select id="supportCodeColumn">${parsed.columns.map((name, i) => `<option value="${i}" ${parsed.codeColumn === i ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label><label>Columna de cantidad<select id="supportQuantityColumn"><option value="-1">1 pieza por renglón</option>${parsed.columns.map((name, i) => `<option value="${i}" ${parsed.quantityColumn === i ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label></div><label class="support-check"><input id="supportHasHeader" type="checkbox" ${parsed.hasHeader ? 'checked' : ''}> La primera fila contiene encabezados</label>` : ''}<div class="support-preview-table"><table><caption>Vista previa de ${Math.min(4, parsed.preview.length)} renglones</caption><thead><tr>${parsed.columns.map(name => `<th>${esc(name)}</th>`).join('')}</tr></thead><tbody>${parsed.preview.map(cells => `<tr>${cells.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${parsed.errors.length ? `<div class="error" role="alert">${parsed.errors.slice(0,5).map(esc).join('<br>')}${parsed.errors.length > 5 ? '<br>Hay más filas por corregir.' : ''}</div>` : `<p class="tiny">${parsed.entries.length} renglones · ${parsed.entries.reduce((sum, x) => sum + x.quantity, 0)} piezas. Los códigos repetidos sumarán sus cantidades.</p>`}<button id="supportAddPaste" type="button" class="primary" ${disable(locked() || parsed.errors.length > 0)}>Agregar lista a la fila</button></div>`;
  }
  function paint() {
    if (!active()) return;
    const focus = root.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focus?.id, focusQty = focus?.dataset?.supportQty, caret = focus?.selectionStart;
    const rows = [...batch.state.rows];
    if (ui.sort === 'location') rows.sort((a,b) => (a.location || '\uffff').localeCompare(b.location || '\uffff', 'es', {numeric:true}));
    const pieces = rows.reduce((sum, row) => sum + row.quantity, 0), done = rows.filter(x => x.status === 'done'), uncertain = rows.some(x => ['sending','uncertain'].includes(x.status));
    const problems = rows.filter(x => lineIssue(x, batch.deptId)).length;
    const allDone = rows.length > 0 && done.length === rows.length, disabled = disable(locked());
    root.innerHTML = `<section class="support-intro"><div><span class="eyebrow">Ventas por internet</span><h2>Todos tus apoyos en una fila</h2><p>Pega la lista de la compu o sigue escaneando. Revisa las ubicaciones y registra el lote.</p></div><span class="support-total"><b>${pieces}</b> piezas</span></section>
      ${batch.storageError ? `<div class="error" role="alert">${esc(batch.storageError)}</div>` : ''}
      ${batch.stale ? `<div class="notice" role="alert">Otra pestaña actualizó el lote. <button type="button" id="supportReload" class="secondary">Cargar avance guardado</button></div>` : ''}
      ${ui.error ? `<div class="error" role="alert">${esc(ui.error)}</div>` : ''}
      <section class="card support-capture"><div class="section-head"><h3>1. Agrega los artículos</h3><span class="tiny">Borrador guardado en este dispositivo</span></div><form id="supportScanForm" class="inline-form"><input id="supportScanCode" placeholder="Escanea con lector USB o escribe SKU / UPC" value="${esc(ui.scanText)}" aria-label="SKU o UPC para agregar a la fila" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="120" ${disable(batch.busy || !!batch.confirmation || batch.stale || !!batch.storageError)}><button class="secondary" ${disable(batch.busy || !!batch.confirmation || batch.stale || !!batch.storageError)}>Agregar</button></form><button id="supportCamera" type="button" class="scan-btn" ${disabled}>▣ Escaneo continuo con cámara</button>
      <details id="supportPasteDetails" class="support-paste" ${ui.pasteOpen?'open':''}><summary>Pegar varios SKU o un reporte</summary><label for="supportPasteText" class="tiny">Una lista de códigos, o una tabla de Excel con SKU / UPC y cantidad.</label><textarea id="supportPasteText" rows="4" placeholder="0012345678&#10;0012345679&#10;0012345680" spellcheck="false" ${disabled}>${esc(ui.text)}</textarea><div class="inline-form"><select id="supportPasteMode" aria-label="Formato del texto pegado" ${disabled}><option value="auto" ${ui.mode === 'auto' ? 'selected' : ''}>Detectar formato</option><option value="list" ${ui.mode === 'list' ? 'selected' : ''}>Solo códigos</option><option value="table" ${ui.mode === 'table' ? 'selected' : ''}>Tabla con cantidades</option></select><button id="supportReadPaste" type="button" class="secondary" ${disabled}>Leer lista</button></div>${pastePreview()}</details></section>
      <section class="card support-list-card"><div class="section-head"><div><h3>2. Revisa la fila</h3><p class="tiny">${rows.length} artículos · ${done.length} guardados${problems ? ' · ' + problems + ' por revisar' : ''}</p></div><select id="supportSort" class="compact" aria-label="Orden de la fila"><option value="capture" ${ui.sort === 'capture' ? 'selected' : ''}>Orden de captura</option><option value="location" ${ui.sort === 'location' ? 'selected' : ''}>Ordenar por marbete</option></select></div><div class="support-rows">${rows.length ? rows.map(rowHTML).join('') : '<div class="empty small-empty"><b>La fila está lista para recibir apoyos</b><p>Los artículos aparecerán aquí con su existencia y marbete.</p></div>'}</div></section>
      <div class="support-live tiny" role="status" aria-live="polite">${batch.busy ? 'Procesando y verificando…' : batch.pending ? `Consultando ${batch.pending} captura(s)…` : esc(batch.message)}</div>
      <section class="card support-checkout"><label for="supportNote">Nota del lote (opcional)</label><input id="supportNote" maxlength="500" value="${esc(batch.state.note)}" placeholder="Ej. Apoyos del turno de la mañana" ${disabled}><p class="tiny">Responsable: ${esc(batch.actor || 'Sin identificar')} · Lote ${esc(batch.state.id.slice(0,8))}</p>${uncertain ? `<div class="notice"><b>Hay salidas por verificar</b><p>El avance se conservó. Verificar consulta el historial sin volver a enviar las piezas.</p><button id="supportVerify" type="button" class="secondary" ${disabled}>Verificar avance</button></div>` : ''}${batch.confirmation ? `<div class="support-confirm" role="region" aria-label="Confirmar salida del lote"><h3>Confirmar ${batch.confirmation.pieces} piezas en ${batch.confirmation.rows} artículos</h3><p>Se descontará la mercancía y se registrará una salida por artículo con el mismo número de lote.</p>${batch.confirmation.totalOnly ? `<label class="support-check"><input id="supportAcknowledge" type="checkbox" ${ui.acknowledge ? 'checked' : ''} ${disable(batch.busy)}> Confirmo ${batch.confirmation.totalOnly} fila(s) sin cantidad contada por marbete. Se descontará solo el stock total; el marbete, si existe, quedará en la nota como referencia.</label>` : ''}<div class="quick-row"><button id="supportConfirm" type="button" class="danger" ${disable(batch.busy)}>Confirmar salida del lote</button><button id="supportCancelConfirm" type="button" class="secondary" ${disable(batch.busy)}>Volver a editar</button></div></div>` : allDone ? `<div class="success"><b>✓ Lote completado</b><p>${pieces} piezas registradas. El historial conserva el lote y su responsable.</p></div><button id="supportNewBatch" type="button" class="primary" ${disabled}>Abrir nuevo lote</button>` : `<button id="supportReview" type="button" class="primary" ${disable(locked() || !rows.length || uncertain)}>Revisar salida de ${rows.filter(x => x.status === 'draft').reduce((sum,x) => sum + x.quantity, 0)} piezas</button>`}</section>`;
    wire();
    const restore = focusId ? $(focusId) : focusQty ? root.querySelector(`[data-support-qty="${CSS.escape(focusQty)}"]`) : null;
    if (restore && !restore.disabled) { restore.focus({preventScroll:true}); if (typeof caret === 'number' && restore.type !== 'number') try { restore.setSelectionRange(caret, caret); } catch {} }
  }
  async function saveLocation(code, zone = null) {
    ui.marbete = code; ui.rowError = ''; ui.missing = false;
    try { await batch.assign(ui.openRow, code, zone, admin); ui.openRow = ''; }
    catch (error) { ui.rowError = error.message; ui.missing = error.code === 'NOT_REGISTERED'; }
    paint();
  }
  function wire() {
    $('supportScanForm').onsubmit = event => {
      event.preventDefault(); const input = $('supportScanCode'), code = input.value.trim();
      if (!code) return; input.value = ''; ui.scanText=''; input.focus(); run(() => batch.add([{code, quantity:1}]));
    };
    $('supportScanCode').oninput = event => { ui.scanText=event.target.value; };
    $('supportPasteDetails').ontoggle = event => { if (active() && event.target === $('supportPasteDetails')) ui.pasteOpen=event.target.open; };
    $('supportCamera').onclick = () => run(async () => {
      await startScanner(async code => {
        if (!active()) { stopScanner(); return; }
        await batch.add([{code,quantity:1}]); return `${code} agregado · ${batch.state.rows.reduce((sum, row) => sum + row.quantity, 0)} piezas en el lote`;
      }, 'SKU / UPC', {continuous:true});
    });
    $('supportPasteText').oninput = event => { ui.text = event.target.value; ui.parsed = null; $('supportAddPaste')?.setAttribute('disabled',''); };
    $('supportPasteMode').onchange = event => { ui.mode = event.target.value; ui.parsed = null; ui.options = {}; paint(); };
    $('supportReadPaste').onclick = () => run(() => { ui.options = {}; parse(); });
    $('supportCodeColumn')?.addEventListener('change', event => run(() => { ui.options.codeColumn = Number(event.target.value); parse(); }));
    $('supportQuantityColumn')?.addEventListener('change', event => run(() => { ui.options.quantityColumn = Number(event.target.value); parse(); }));
    $('supportHasHeader')?.addEventListener('change', event => run(() => { ui.options.hasHeader = event.target.checked; parse(); }));
    $('supportAddPaste')?.addEventListener('click', () => run(async () => {
      parse(); if (ui.parsed.errors.length) throw Error('Corrige las filas señaladas antes de agregarlas.');
      await batch.add(ui.parsed.entries, ui.parsed.fingerprint); ui.parsed = null; ui.text = ''; ui.options = {}; ui.pasteOpen=false; $('supportScanCode')?.focus();
    }));
    root.querySelectorAll('[data-support-qty]').forEach(input => input.oninput = () => {
      try {
        batch.edit(input.dataset.supportQty, 'quantity', input.value, false); input.setCustomValidity('');
        const count = batch.state.rows.reduce((sum,row) => sum + row.quantity, 0);
        root.querySelector('.support-total b').textContent = count;
        if ($('supportReview')) $('supportReview').textContent = `Revisar salida de ${batch.state.rows.filter(x=>x.status==='draft').reduce((sum,row)=>sum+row.quantity,0)} piezas`;
      } catch (error) { input.setCustomValidity(error.message); }
    });
    root.querySelectorAll('[data-support-location]').forEach(input => input.onchange = () => run(() => batch.edit(input.dataset.supportLocation, 'location', input.value)));
    root.querySelectorAll('[data-support-remove]').forEach(button => button.onclick = () => run(() => batch.remove(button.dataset.supportRemove)));
    root.querySelectorAll('[data-support-assign]').forEach(button => button.onclick = () => { ui.openRow = button.dataset.supportAssign; ui.marbete = ''; ui.rowError = ''; ui.missing = false; paint(); $('supportMarbeteCode')?.focus(); });
    $('supportSort').onchange = event => { ui.sort = event.target.value; paint(); };
    $('supportNote').oninput = event => { try { batch.setNote(event.target.value, false); } catch (error) { ui.error = error.message; } };
    $('supportMarbeteCode')?.addEventListener('input', event => { ui.marbete = event.target.value; ui.missing = false; $('supportRegisterMarbete')?.setAttribute('disabled',''); });
    $('supportLocationForm')?.addEventListener('submit', event => { event.preventDefault(); saveLocation($('supportMarbeteCode').value); });
    $('supportScanMarbete')?.addEventListener('click', () => run(() => startScanner(code => { if (active()) saveLocation(code); }, 'marbete de este artículo')));
    $('supportCloseLocation')?.addEventListener('click', () => { stopScanner(); ui.openRow = ''; paint(); });
    $('supportRegisterMarbete')?.addEventListener('click', () => saveLocation(ui.marbete, $('supportNewZone').value));
    $('supportReview')?.addEventListener('click', () => run(async () => {
      for (const input of root.querySelectorAll('[data-support-qty]')) if (!input.reportValidity()) throw Error('Corrige las cantidades antes de revisar.');
      ui.acknowledge = false; await batch.review();
    }));
    $('supportCancelConfirm')?.addEventListener('click', () => { batch.confirmation = null; paint(); });
    $('supportAcknowledge')?.addEventListener('change', event => { ui.acknowledge = event.target.checked; });
    $('supportConfirm')?.addEventListener('click', () => run(() => batch.submit({acknowledgeTotalOnly:ui.acknowledge})));
    $('supportVerify')?.addEventListener('click', () => run(() => batch.verify()));
    $('supportNewBatch')?.addEventListener('click', () => run(() => { batch.newBatch(); ui.pasteOpen=true; }));
    $('supportReload')?.addEventListener('click', () => run(() => batch.sync()));
  }
  const onStorage = event => { if (event.key === batch.key && active()) { batch.stale = true; batch.confirmation = null; paint(); } };
  window.addEventListener('storage', onStorage);
  batch.onChange = paint; paint();
  return () => { window.removeEventListener('storage', onStorage); batch.onChange = () => {}; };
}
