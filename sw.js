const CACHE='electricity-split-v11';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];

function normalizedRequest(request){
  try{
    const url=new URL(request.url);
    if(url.origin!==self.location.origin) return request;
    url.search=''; url.hash='';
    return new Request(url.toString(),{method:'GET',headers:request.headers,mode:request.mode,credentials:request.credentials,redirect:request.redirect,cache:'no-store'});
  }catch(e){return request;}
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const key=normalizedRequest(event.request);
  event.respondWith(
    fetch(event.request)
      .then(response=>{
        if(response && response.ok){
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(key,copy)).catch(()=>{});
        }
        return response;
      })
      .catch(()=>caches.match(key).then(cached=>cached||caches.match('./index.html')))
  );
});
