const CACHE='travel-os-hours-final-v9';
const ASSETS=['./','./index.html','./app.css','./app.js','./data.js','./config.js','./auth.js','./local-db.js','./sync-engine.js','./manifest.json','./icon.svg','./404.html'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.hostname.endsWith('.supabase.co')) return;
  if(url.origin!==self.location.origin) return;
  const isNav=req.mode==='navigate';
  const isCore=/\.(?:js|css|html)$/.test(url.pathname)||isNav;
  if(isCore){
    event.respondWith(fetch(req).then(res=>{
      const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
      return res;
    }).catch(()=>caches.match(req)));
  }else{
    event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{
      const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
      return res;
    })));
  }
});