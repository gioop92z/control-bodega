// VANTIS: identificación operativa sin roles ni clave visible.
import {startScanner,stopScanner} from './scanner.js?v=5.8.3';
const KEY='nova.employeeNumber';
const $=id=>document.getElementById(id);
const validNumber=value=>/^[0-9]{4,12}$/.test(String(value||'').replace(/\s/g,''));
const readNumber=()=>String(sessionStorage.getItem(KEY)||'').trim();
let scheduled=false;
function unlock(){
  document.documentElement.classList.remove('vantis-session-pending');
  $('vantisEmployeeGate')?.remove();
  const header=document.querySelector('.access-label');
  if(header&&validNumber(readNumber()))header.textContent='● Empleado '+readNumber();
}
function showGate(){
  scheduled=false;
  if(document.querySelector('.login-shell')){
    document.documentElement.classList.remove('vantis-session-pending');return;
  }
  if(!document.querySelector('.app-shell'))return;
  if(validNumber(readNumber())){unlock();return;}
  if($('vantisEmployeeGate'))return;
  document.documentElement.classList.add('vantis-session-pending');
  const overlay=document.createElement('div');
  overlay.id='vantisEmployeeGate';
  overlay.className='vantis-employee-gate';
  overlay.innerHTML=`
    <section class="vantis-employee-card" role="dialog" aria-modal="true" aria-labelledby="vantisEmployeeTitle">
      <span class="eyebrow">VANTIS · IDENTIFICACIÓN</span>
      <h2 id="vantisEmployeeTitle">¿Cuál es tu número de empleado?</h2>
      <p>Este número quedará asociado a tus movimientos de mercancía.</p>
      <form id="vantisEmployeeForm">
        <label for="vantisEmployeeInput">Número de empleado</label>
        <input id="vantisEmployeeInput" autocomplete="off" inputmode="numeric" pattern="[0-9]{4,12}" maxlength="12" required placeholder="Ej. 16647310">
        <p id="vantisEmployeeError" role="alert" class="tiny"></p>
        <button type="submit" class="primary">Continuar</button>
        <button id="vantisEmployeeScan" type="button" class="secondary">▣ Escanear gafete</button>
      </form>
    </section>`;
  document.body.appendChild(overlay);
  const input=$('vantisEmployeeInput');
  const accept=value=>{
    const number=String(value||'').replace(/\s/g,'');
    if(!validNumber(number)){
      $('vantisEmployeeError').textContent='Escribe de 4 a 12 dígitos del gafete.';return;
    }
    sessionStorage.setItem(KEY,number);
    sessionStorage.setItem('vantis.session.ready','1');
    sessionStorage.setItem('vantis.session.role','seller');
    unlock();
  };
  $('vantisEmployeeForm').onsubmit=event=>{event.preventDefault();accept(input.value)};
  $('vantisEmployeeScan').onclick=()=>{
    startScanner(code=>{stopScanner();accept(code)},'gafete de empleado',{qrEnabled:true})
      .catch(()=>{$('vantisEmployeeError').textContent='Cámara no disponible. Escribe tu número.';});
  };
  input.focus({preventScroll:true});
}
function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(showGate);}
document.addEventListener('click',event=>{
  if(event.target instanceof Element&&event.target.closest('#logout')){
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem('vantis.session.ready');
    sessionStorage.removeItem('vantis.session.role');
    sessionStorage.removeItem('vantis.session.department');
    document.documentElement.classList.add('vantis-session-pending');
  }
},true);
new MutationObserver(schedule).observe(document.getElementById('app')||document.body,{childList:true});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
