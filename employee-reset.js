import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const sbReset = createClient(
  'https://dkqovohxkxlcccvagpij.supabase.co',
  'sb_publishable_iz06RtaObND0dWOpuX2vKg_wZVbrZCv',
  { auth: { persistSession: true, autoRefreshToken: true } }
);

const escReset = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function newPin(used){
  const a = new Uint32Array(1);
  let pin = '';
  do {
    crypto.getRandomValues(a);
    pin = String(10000000 + (a[0] % 90000000));
  } while (used.has(pin));
  used.add(pin);
  return pin;
}

function csvDownload(rows){
  const q = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const csv = ['Nombre,Clave,PIN,Puesto', ...rows.map(r => [r.nombre,r.clave,r.pin,r.puesto].map(q).join(','))].join('\n');
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `accesos_empleados_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function employeeData(){
  const [er, ar] = await Promise.all([
    sbReset.from('empleados_operativos').select('id,clave,nombre,puesto,activo').eq('activo',true).order('nombre'),
    sbReset.from('empleado_operativo_departamentos').select('empleado_id,departamento_id')
  ]);
  if (er.error) throw er.error;
  if (ar.error) throw ar.error;
  return {employees: er.data || [], assignments: ar.data || []};
}

async function resetOne(emp, assignments, pin){
  const deps = assignments.filter(x => x.empleado_id === emp.id).map(x => x.departamento_id);
  const r = await sbReset.rpc('admin_guardar_empleado', {
    p_id: emp.id,
    p_clave: String(emp.clave || '10'),
    p_nombre: emp.nombre,
    p_puesto: emp.puesto || '',
    p_pin: pin,
    p_activo: true,
    p_departamentos: deps
  });
  if (r.error) throw r.error;
}

async function resetAll(button, panel){
  if (!confirm('Se reemplazarán los PIN actuales de todos los empleados activos. ¿Continuar?')) return;
  button.disabled = true;
  button.textContent = 'Restableciendo…';
  panel.querySelector('[data-reset-status]').innerHTML = '<p class="muted">Actualizando accesos…</p>';
  try {
    const {employees, assignments} = await employeeData();
    if (!employees.length) throw new Error('No hay empleados activos para restablecer.');
    const used = new Set(), rows = [];
    for (let i=0; i<employees.length; i++) {
      const emp = employees[i], pin = newPin(used);
      button.textContent = `Restableciendo ${i+1}/${employees.length}…`;
      await resetOne(emp, assignments, pin);
      rows.push({nombre:emp.nombre, clave:String(emp.clave || '10'), pin, puesto:emp.puesto || ''});
    }
    window.__employeeResetRows = rows;
    panel.querySelector('[data-reset-status]').innerHTML = `
      <div class="success">✓ ${rows.length} accesos restablecidos. Estos PIN ya funcionan en la app.</div>
      <p class="tiny muted">Guarda esta lista ahora. Por seguridad, después la app no puede consultar los PIN.</p>
      <div class="table-scroll"><table><thead><tr><th>Empleado</th><th>Clave</th><th>PIN nuevo</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${escReset(r.nombre)}</td><td>${escReset(r.clave)}</td><td><b>${escReset(r.pin)}</b></td></tr>`).join('')}
      </tbody></table></div>
      <button type="button" class="secondary" id="downloadEmployeePins">Descargar accesos CSV</button>`;
    document.getElementById('downloadEmployeePins').onclick = () => csvDownload(rows);
  } catch (e) {
    panel.querySelector('[data-reset-status]').innerHTML = `<div class="error">${escReset(e?.message || 'No se pudieron restablecer los accesos.')}</div>`;
  } finally {
    button.disabled = false;
    button.textContent = 'Restablecer PINs de todos';
  }
}

async function resetSingle(id, button){
  try {
    const {employees, assignments} = await employeeData();
    const emp = employees.find(x => x.id === id);
    if (!emp) throw new Error('Empleado no encontrado o inactivo.');
    const pin = newPin(new Set());
    button.disabled = true;
    button.textContent = 'Cambiando…';
    await resetOne(emp, assignments, pin);
    alert(`${emp.nombre}\nClave: ${emp.clave || '10'}\nPIN nuevo: ${pin}\n\nGuárdalo ahora; por seguridad no se puede consultar después.`);
  } catch (e) {
    alert(e?.message || 'No se pudo cambiar el PIN.');
  } finally {
    button.disabled = false;
    button.textContent = 'Nuevo PIN';
  }
}

function inject(){
  const empClave = document.getElementById('empClave');
  const body = document.getElementById('adminBody');
  if (!empClave || !body || body.dataset.employeeResetReady === '1') return;
  body.dataset.employeeResetReady = '1';

  const panel = document.createElement('div');
  panel.className = 'notice';
  panel.innerHTML = `
    <h3>Accesos de empleados</h3>
    <p>Si los PIN anteriores no funcionan, puedes generar accesos nuevos y únicos para todos los empleados activos.</p>
    <button type="button" class="danger" id="resetAllEmployeePins">Restablecer PINs de todos</button>
    <div data-reset-status></div>`;
  body.prepend(panel);
  document.getElementById('resetAllEmployeePins').onclick = e => resetAll(e.currentTarget, panel);

  document.querySelectorAll('[data-emp-toggle]').forEach(toggle => {
    const row = toggle.closest('.product-row');
    if (!row || row.querySelector('[data-emp-reset]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini';
    b.dataset.empReset = toggle.dataset.empToggle;
    b.textContent = 'Nuevo PIN';
    b.onclick = () => resetSingle(toggle.dataset.empToggle, b);
    toggle.parentElement?.appendChild(b);
  });
}

new MutationObserver(inject).observe(document.documentElement, {subtree:true, childList:true});
inject();
