(()=>{
  const originalFetch=window.fetch.bind(window);
  const RPC_SEARCH='/rest/v1/rpc/buscar_producto_codigo';
  const RPC_CREATE='https://dkqovohxkxlcccvagpij.supabase.co/rest/v1/rpc/crear_producto_codigo';

  function productEntryScreen(code){
    if(document.getElementById('manualMove')||document.getElementById('manualCount')) return true;
    return !!document.getElementById('manualSearch') && /^\d{6,20}$/.test(String(code||'').trim());
  }

  function currentDepartment(){return localStorage.getItem('inv.dept')||''}

  function showAdded(code){
    let el=document.getElementById('autoAddToast');
    if(!el){
      el=document.createElement('div');
      el.id='autoAddToast';
      el.className='toast';
      document.body.appendChild(el);
    }
    el.textContent=`✓ Producto nuevo agregado · SKU/UPC ${code}`;
    clearTimeout(window.__autoAddToastTimer);
    window.__autoAddToastTimer=setTimeout(()=>el.remove(),3600);
  }

  async function createProduct(code,headersSource){
    const dept=currentDepartment();
    if(!dept) return null;
    const headers=new Headers(headersSource||{});
    headers.set('Content-Type','application/json');
    const r=await originalFetch(RPC_CREATE,{
      method:'POST',headers,
      body:JSON.stringify({p_token:null,p_departamento:dept,p_codigo:String(code||'').trim()})
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
      const clean={...created}; delete clean.creado;
      return new Response(JSON.stringify([clean]),{status:200,headers:{'Content-Type':'application/json; charset=utf-8'}});
    }catch{return response}
  };
})();
