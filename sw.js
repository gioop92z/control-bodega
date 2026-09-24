const CACHE_PREFIX='inventario-';

self.addEventListener('install',event=>{
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith(CACHE_PREFIX)).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

// Intencionalmente no interceptamos fetch.
// Safari debe recibir siempre la respuesta real de red; así evitamos
// "FetchEvent.respondWith ... Returned response is null" cuando no existe cache.
