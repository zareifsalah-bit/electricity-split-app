const NEW_LEDGERLY='https://ledgerly-salah.github.io/ledgerly-app/';
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('ledgerly-shell-')).map(k=>caches.delete(k)));
    await self.registration.unregister();
  })());
});
self.addEventListener('fetch',event=>{
  if(event.request.mode==='navigate'){
    event.respondWith(Promise.resolve(Response.redirect(NEW_LEDGERLY,302)));
  }
});
