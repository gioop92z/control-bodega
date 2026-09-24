(()=>{
  const originalFetch=window.fetch.bind(window);
  const RPC_SEARCH='/rest/v1/rpc/buscar_producto_codigo';
  const RPC_CREATE='https://dkqovohxkxlcccvagpij.supabase.co/rest/v1/rpc/crear_producto_codigo';

  function productEntryScreen(code){
    if(document.getElementById('manualMove')||document.getElementById('manualCount')) return true;
    // En la pantalla Buscar solo damos de alta códigos con forma de SKU/UPC numérico,
    // para no convertir marbetes/ubicaciones alfanuméricas en productos por accidente.
    return !!document.getElementById('manualSearch') && /^\d{6,20}$/.test(String(code||'').trim());
  }

  function currentDepartment(){
    return localStorage.getItem('inv.dept')||'';
  }

  function employeeToken(){
    try{return JSON.parse(localStorage.getItem('inv.employee')||'null')?.token||null}catch{return null}
  }

  function showAdded(code){
    let el=document.getElementById('autoAddToast');
    if(!el){
      el=document.createElement('div');
      el.id='autoAddToast';
      el.style.cssText='position:fixed;left:16px;right:16px;bottom:96px;z-index:10050;padding:14px 16px;border-radius:14px;background:#e8fff1;color:#0b6b35;border:1px solid #98e4b7;box-shadow:0 10px 30px rgba(0,0,0,.18);font:600 15px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center';
      document.body.appendChild(el);
    }
    el.textContent=`✓ Agregado nuevo producto · SKU/UPC ${code}`;
    clearTimeout(window.__autoAddToastTimer);
    window.__autoAddToastTimer=setTimeout(()=>el.remove(),4200);
  }

  async function createProduct(code,headersSource){
    const dept=currentDepartment();
    if(!dept) return null;
    const headers=new Headers(headersSource||{});
    headers.set('Content-Type','application/json');
    const r=await originalFetch(RPC_CREATE,{
      method:'POST',
      headers,
      body:JSON.stringify({
        p_token:employeeToken(),
        p_departamento:dept,
        p_codigo:String(code||'').trim()
      })
    });
    if(!r.ok) return null;
    const data=await r.json().catch(()=>null);
    const row=Array.isArray(data)?data[0]:data;
    if(row?.creado) showAdded(row.sku||code);
    return row||null;
  }

  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input?.url||'');
    let bodyText='';
    try{
      if(typeof init?.body==='string') bodyText=init.body;
      else if(input instanceof Request) bodyText=await input.clone().text();
    }catch{}

    const response=await originalFetch(input,init);
    if(!url.includes(RPC_SEARCH)||!response.ok) return response;

    let payload=null,found=null;
    try{payload=bodyText?JSON.parse(bodyText):null;found=await response.clone().json()}catch{return response}
    const code=String(payload?.p_codigo||'').trim();
    if(!code||!productEntryScreen(code)) return response;

    const dept=currentDepartment();
    const row=Array.isArray(found)&&found.length?found[0]:null;
    if(row&&(!dept||row.departamento_id===dept)) return response;

    try{
      const sourceHeaders=init?.headers||(input instanceof Request?input.headers:{});
      const created=await createProduct(code,sourceHeaders);
      if(!created) return response;
      const clean={...created};
      delete clean.creado;
      return new Response(JSON.stringify([clean]),{
        status:200,
        headers:{'Content-Type':'application/json; charset=utf-8'}
      });
    }catch{return response}
  };
})();
