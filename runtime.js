(()=>{
  const WRITE_SELECTORS=[
    '#saveMove','#runImport','#saveLoc','#saveAssign','#saveEmp','#newCount',
    '#addCount','#setCount','#pauseCount','#closeCount','[data-edit]',
    '[data-toggle-dept]','[data-emp-toggle]','#teamSave','#quickSave',
    '[data-team-toggle]','[data-team-pin]','[data-team-edit]'
  ].join(',');

  function ensureStyles(){
    if(document.getElementById('runtimeStyles'))return;
    const s=document.createElement('style');
    s.id='runtimeStyles';
    s.textContent=`
      #offlineBanner{position:fixed;left:12px;right:12px;top:max(10px,env(safe-area-inset-top));z-index:10000;background:#7c2d12;color:#fff;border-radius:14px;padding:10px 14px;font:700 13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.22);text-align:center}
      #offlineToast{position:fixed;left:50%;bottom:calc(92px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:10001;width:min(92vw,440px);background:#17202a;color:#fff;border-radius:14px;padding:12px 14px;font:700 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.28);text-align:center}
    `;
    document.head.appendChild(s);
  }

  function syncBanner(){
    ensureStyles();
    let b=document.getElementById('offlineBanner');
    if(navigator.onLine){b?.remove();return;}
    if(!b){
      b=document.createElement('div');
      b.id='offlineBanner';
      b.setAttribute('role','status');
      b.textContent='Sin conexión · puedes consultar lo que ya está en pantalla, pero no se guardarán cambios.';
      document.body.appendChild(b);
    }
  }

  function warnOffline(){
    ensureStyles();
    let t=document.getElementById('offlineToast');
    if(!t){t=document.createElement('div');t.id='offlineToast';document.body.appendChild(t)}
    t.textContent='Necesitas conexión para guardar este cambio.';
    clearTimeout(window.__offlineToastTimer);
    window.__offlineToastTimer=setTimeout(()=>t.remove(),2600);
  }

  window.addEventListener('online',syncBanner);
  window.addEventListener('offline',syncBanner);
  document.addEventListener('DOMContentLoaded',syncBanner,{once:true});
  syncBanner();

  document.addEventListener('click',e=>{
    if(navigator.onLine)return;
    const target=e.target instanceof Element?e.target.closest(WRITE_SELECTORS):null;
    if(!target)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    warnOffline();
  },true);

  document.addEventListener('submit',e=>{
    if(navigator.onLine)return;
    const form=e.target;
    if(!(form instanceof HTMLFormElement))return;
    if(form.id==='newDept'||form.id==='loginForm'){
      e.preventDefault();
      e.stopImmediatePropagation();
      warnOffline();
    }
  },true);
})();
