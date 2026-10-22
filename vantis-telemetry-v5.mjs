// VANTIS 5 · métricas operativas anónimas: no persiste SKU, ubicación ni identidad.
const captures=[],server=[];
const limit=120;
const msNow=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
export function startMetric(){return msNow();}
export function scanMetric(){captures.push(Date.now());if(captures.length>limit)captures.shift();}
export function serverMetric(start,ok){const elapsed=Math.max(0,msNow()-start);server.push({ms:elapsed,ok:!!ok,at:Date.now()});if(server.length>limit)server.shift();}
export function telemetrySnapshot(){
 const recent=captures.filter(x=>Date.now()-x<=60000);
 const results=server.slice(-30);
 const times=results.filter(x=>x.ok).map(x=>x.ms).sort((a,b)=>a-b);
 const p95=times.length?times[Math.min(times.length-1,Math.ceil(times.length*.95)-1)]:null;
 return {perMinute:recent.length,totalScans:captures.length,latencyMs:times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):null,
  p95Ms:p95==null?null:Math.round(p95),requests:results.length,errors:results.filter(x=>!x.ok).length};
}
