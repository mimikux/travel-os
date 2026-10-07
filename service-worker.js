const CACHE='travel-os-forwarder-v42';
const ASSETS=['./','./index.html','./app.css?v=20261007-forwarder-v42','./app.js?v=20261007-forwarder-v42','./data.js?v=20261007-forwarder-v42','./config.js?v=20261007-forwarder-v42','./auth.js?v=20261007-forwarder-v42','./local-db.js?v=20261007-forwarder-v42','./sync-engine.js?v=20261007-forwarder-v42','./manifest.json','./icon.svg','./404.html'];
const CDN_HOSTS=new Set(['unpkg.com','cdn.jsdelivr.net']);

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;

  const url=new URL(req.url);

  // Never intercept Supabase API calls. They must fail normally while offline so
  // the app can queue edits instead of mistaking a cached response for a save.
  if(url.hostname.endsWith('.supabase.co'))return;

  // Cache third-party runtime assets after the first successful online load.
  if(CDN_HOSTS.has(url.hostname)||url.hostname==='tile.openstreetmap.org'||url.hostname.endsWith('.tile.openstreetmap.org')){
    event.respondWith(
      caches.match(req).then(hit=>{
        if(hit)return hit;
        return fetch(req).then(res=>{
          const copy=res.clone();
          caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
          return res;
        });
      })
    );
    return;
  }

  if(url.origin!==self.location.origin)return;

  const isNav=req.mode==='navigate';
  const isCore=/\.(?:js|css|html)$/.test(url.pathname)||isNav;

  if(isCore){
    event.respondWith(
      fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
        return res;
      }).catch(async()=>{
        const exact=await caches.match(req);
        if(exact)return exact;
        if(isNav){
          return (await caches.match('./index.html')) || (await caches.match('./'));
        }
        return caches.match(req);
      })
    );
  }else{
    event.respondWith(
      caches.match(req).then(hit=>hit||fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});
        return res;
      }))
    );
  }
});
