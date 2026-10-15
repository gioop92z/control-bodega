(()=>{
  const nativeFetch=window.fetch.bind(window);
  const MOVE_RPC='/rest/v1/rpc/mover_stock_v2';
  const TIMEOUT_MS=15000;
  const urlOf=input=>typeof input==='string'?input:(input?.url||'');

  async function timedFetch(input,init){
    const controller=new AbortController();
    let relay=null;
    if(init?.signal){
      if(init.signal.aborted) controller.abort(init.signal.reason);
      else {
        relay=()=>controller.abort(init.signal.reason);
        init.signal.addEventListener('abort',relay,{once:true});
      }
    }
    const timer=setTimeout(()=>controller.abort(new DOMException('Tiempo de espera agotado','TimeoutError')),TIMEOUT_MS);
    try{
      const request=input instanceof Request?input.clone():input;
      return await nativeFetch(request,{...(init||{}),signal:controller.signal});
    } finally {
      clearTimeout(timer);
      if(relay&&init?.signal) init.signal.removeEventListener('abort',relay);
    }
  }

  window.fetch=async function novaFetch(input,init){
    const url=urlOf(input);
    if(!url.includes(MOVE_RPC)) return nativeFetch(input,init);

    try{
      // A timeout or gateway error can arrive after the database committed.
      // Stock mutations must be reconciled by movement ID, never blindly retried.
      return await timedFetch(input,init);
    } catch(error){
      console.error('Nova: la solicitud de movimiento no pudo completarse.',error);
      return new Response(JSON.stringify({
        message:'VANTIS no pudo confirmar el movimiento. Revisa el avance del lote o el historial antes de volver a capturar la mercancía.'
      }),{
        status:504,
        statusText:'Gateway Timeout',
        headers:{'Content-Type':'application/json'}
      });
    }
  };
})();
