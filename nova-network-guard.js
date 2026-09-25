(()=>{
  const nativeFetch=window.fetch.bind(window);
  const MOVE_RPC='/rest/v1/rpc/mover_stock_v2';
  const TIMEOUT_MS=15000;
  const RETRY_STATUS=new Set([408,503,504,520]);

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
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
      let response=await timedFetch(input,init);
      if(RETRY_STATUS.has(response.status)){
        console.warn(`Nova: movimiento recibió HTTP ${response.status}; reintentando una vez.`);
        await sleep(650);
        response=await timedFetch(input,init);
      }
      return response;
    } catch(error){
      console.error('Nova: la solicitud de movimiento no pudo completarse.',error);
      return new Response(JSON.stringify({
        message:'Nova no pudo confirmar el movimiento en 15 segundos. El botón fue liberado para evitar que la operación quede bloqueada. Revisa tu conexión y el stock antes de volver a intentar.'
      }),{
        status:504,
        statusText:'Gateway Timeout',
        headers:{'Content-Type':'application/json'}
      });
    }
  };
})();
