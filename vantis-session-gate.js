import { startScanner, stopScanner } from './scanner.js';

const EMP='nova.employeeNumber';
const READY='vantis.session.ready';
const DEPT='vantis.session.department';
const ROLE='vantis.session.role';

const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function role(){
  const t=document.querySelector('.access-label')?.textContent||'';
  if(/Administrador|acceso\s*99/i.test(t))return 'admin';
  if(/Vendedor general|Vendedor|acceso\s*10/i.test(t))return 'seller';
  return null;
}
function emp(){return (sessionStorage.getItem(EMP)||'').trim()}
function saveEmp(v){v=String(v||'').replace(/[\u200B-\u200D\uFEFF]/g,'').trim().slice(0,80);if(!v)return false;sessionStorage.setItem(EMP,v);return true}
function depts(){
  const s=$('deptSelect');
  if(s)return [...s.options].map(o=>({id:String(o.value||'').trim(),name:String(o.textContent||'').trim()})).filter(x=>x.id&&x.name);
  const id=(localStorage.getItem('inv.dept')||'').trim(),name=document.querySelector('.topbar h2')?.textContent?.trim()||'';
  return id&&name&&!/Sin departamento/i.test(name)?[{id,name}]:[];
}
function clear(){sessionStorage.removeItem(EMP);sessionStorage.removeItem(READY);sessionStorage.removeItem(DEPT);sessionStorage.removeItem(ROLE)}
function valid(r,ds){
  if(sessionStorage.getItem(READY)!=='1'||!emp()||sessionStorage.getItem(ROLE)!==r)return false;
  const d=sessionStorage.getItem(DEPT)||'';
  return ds.length?ds.some(x=>x.id===d):(r==='admin'&&d==='__none__');
}
function styles(){
  if($('vantisSessionStyles'))return;
  const x=document.createElement('style');x.id='vantisSessionStyles';
  x.textContent='.vantis-session-gate{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:20px;background:rgba(10,24,33,.76);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}.vantis-session-card{width:min(100%,440px);max-height:90vh;overflow:auto;background:#fff;border-radius:27px;padding:24px;box-shadow:0 30px 90px rgba(0,0,0,.3)}.vantis-session-card h2{font-size:27px;margin:6px 0 8px}.vantis-session-card p{color:var(--muted);font-size:13px;line-height:1.5}.vantis-session-steps{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 16px}.vantis-session-steps i{height:4px;border-radius:99px;background:#dfe5e8}.vantis-session-steps i.on{background:#e5007d}.vantis-session-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:13px}.vantis-session-actions button{width:100%;margin:0}.vantis-who{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#f3f7f8;border:1px solid #dfe7ea;border-radius:14px;padding:10px 12px;margin:10px 0 12px}.vantis-who div{display:grid;gap:2px}.vantis-who small{color:var(--muted);font-size:10px}.vantis-who button{border:0;background:#e7edef;border-radius:10px;padding:7px 9px;font-size:10px;font-weight:900}.vantis-depts{display:grid;gap:8px;margin-top:12px}.vantis-dept{width:100%;border:1px solid #d9e2e6;background:#fff;border-radius:15px;padding:13px 14px;display:flex;align-items:center;justify-content:space-between;text-align:left;color:var(--text);font-weight:800}.vantis-dept.current{border-color:#e5007d;background:#fff5fa}.vantis-dept span{display:grid;gap:2px}.vantis-dept small{color:var(--muted);font-size:10px;font-weight:600}.vantis-session-chip{display:inline-flex;align-items:center;margin-left:5px;padding:3px 7px;border-radius:999px;background:#fff2f9;color:#a8005d;font-size:9px;font-weight:900;border:1px solid #f2cade}@media(max-width:430px){.vantis-session-actions{grid-template-columns:1fr}.vantis-session-card{padding:20px}}';
  document.head.appendChild(x);
}
function chip(){
  const a=document.querySelector('.access-label'),r=role(),n=emp();if(!a||!r||!n)return;
  let c=$('vantisSessionChip');if(!c){c=document.createElement('span');c.id='vantisSessionChip';c.className='vantis-session-chip';a.appendChild(c)}
  c.textContent=r==='admin'?'Jefe '+n:'Emp. '+n;
}
function finish(g,r,d){
  sessionStorage.setItem(ROLE,r);sessionStorage.setItem(DEPT,d);sessionStorage.setItem(READY,'1');
  if(d!=='__none__'){localStorage.setItem('inv.dept',d);const s=$('deptSelect');if(s&&s.value!==d){s.value=d;s.dispatchEvent(new Event('change',{bubbles:true}))}}
  g.remove();requestAnimationFrame(chip);
}
function departmentStep(g,r){
  const ds=depts(),n=emp(),current=localStorage.getItem('inv.dept')||'',who=r==='admin'?'Jefe':'Vendedor';
  if(!ds.length){
    g.innerHTML='<section class="vantis-session-card"><div class="eyebrow">VANTIS · DEPARTAMENTO</div><div class="vantis-session-steps"><i class="on"></i><i class="on"></i></div><h2>No hay departamentos activos</h2><div class="vantis-who"><div><small>'+who+' identificado</small><b>Gafete '+esc(n)+'</b></div></div><p>'+(r==='admin'?'Puedes continuar para crear o activar un departamento desde Ajustes.':'Pide a un administrador que active un departamento antes de trabajar.')+'</p><div class="vantis-session-actions">'+(r==='admin'?'<button id="vantisNoDept" class="primary" type="button">Entrar a Ajustes</button>':'<button id="vantisNoDeptLogout" class="secondary" type="button">Cerrar sesión</button>')+'</div></section>';
    $('vantisNoDept')?.addEventListener('click',()=>finish(g,r,'__none__'));$('vantisNoDeptLogout')?.addEventListener('click',()=>$('logout')?.click());return;
  }
  const opts=ds.map(d=>'<button type="button" class="vantis-dept '+(d.id===current?'current':'')+'" data-vantis-dept="'+esc(d.id)+'"><span><b>'+esc(d.name)+'</b><small>'+(d.id===current?'Último departamento usado':'Seleccionar para esta sesión')+'</small></span><strong>›</strong></button>').join('');
  g.innerHTML='<section class="vantis-session-card"><div class="eyebrow">VANTIS · DEPARTAMENTO</div><div class="vantis-session-steps"><i class="on"></i><i class="on"></i></div><h2>¿En qué departamento trabajarás?</h2><div class="vantis-who"><div><small>'+who+' identificado</small><b>Gafete '+esc(n)+'</b></div><button id="vantisChangeBadge" type="button">Cambiar</button></div><p>Selecciona el departamento para esta sesión. Inventario, búsquedas, movimientos y conteos iniciarán ahí.</p><div class="vantis-depts">'+opts+'</div></section>';
  $('vantisChangeBadge').onclick=()=>{sessionStorage.removeItem(EMP);sessionStorage.removeItem(READY);identityStep(g,r)};
  document.querySelectorAll('[data-vantis-dept]').forEach(b=>b.onclick=()=>finish(g,r,b.dataset.vantisDept));
}
function identityStep(g,r){
  g.innerHTML='<section class="vantis-session-card"><div class="eyebrow">VANTIS · IDENTIFICACIÓN</div><div class="vantis-session-steps"><i class="on"></i><i></i></div><h2>Identifica tu gafete</h2><p>Identifica al '+(r==='admin'?'jefe':'vendedor')+' que está entrando. Después elegirás el departamento de trabajo.</p><label>Número de empleado / gafete</label><input id="vantisBadge" autocomplete="off" inputmode="numeric" placeholder="Escanea o escribe tu número"><div class="vantis-session-actions"><button id="vantisScanBadge" class="secondary" type="button">▣ Escanear gafete</button><button id="vantisBadgeNext" class="primary" type="button">Continuar</button></div><small>El PIN del administrador sigue siendo privado; el gafete solo identifica quién abrió la sesión.</small></section>';
  const i=$('vantisBadge'),go=v=>{if(!saveEmp(v)){i.focus();return}departmentStep(g,r)};
  $('vantisBadgeNext').onclick=()=>go(i.value);$('vantisScanBadge').onclick=()=>startScanner(v=>{stopScanner();go(v)},r==='admin'?'gafete de jefe':'gafete de vendedor').catch(()=>i.focus());setTimeout(()=>i.focus(),50);
}
function gate(){
  if(!document.querySelector('.app-shell'))return;
  const r=role();if(!r)return;const ds=depts();
  if(valid(r,ds)){chip();return}
  if($('vantisSessionGate'))return;styles();
  const g=document.createElement('div');g.id='vantisSessionGate';g.className='vantis-session-gate';document.body.appendChild(g);
  if(emp())departmentStep(g,r);else identityStep(g,r);
}
function adminTag(){
  if(role()!=='admin')return;const i=$('moveNote'),n=emp();if(!i||!n)return;const t='Jefe '+n;if(!i.value.toLowerCase().includes(t.toLowerCase()))i.value=i.value.trim()?t+' · '+i.value.trim():t;
}
document.addEventListener('click',e=>{const t=e.target instanceof Element?e.target:null;if(!t)return;if(t.closest('#logout')){clear();$('vantisSessionGate')?.remove();return}if(t.closest('#saveMove'))adminTag()},true);
document.addEventListener('change',e=>{const x=e.target;if(x instanceof HTMLSelectElement&&x.id==='deptSelect'&&sessionStorage.getItem(READY)==='1')sessionStorage.setItem(DEPT,x.value)});
const ob=new MutationObserver(()=>requestAnimationFrame(()=>{gate();chip()}));ob.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',()=>{gate();chip()},{once:true});gate();chip();
