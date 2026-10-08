const CACHE='paperdrop-shell-eed1a3b4ec8e6a56';
const SHELL=['./pdf-worker-6.4.299.mjs','./','./index.html','./style-eed1a3b4ec8e6a56.css','./app-eed1a3b4ec8e6a56.js','./config.json','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('paperdrop-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'){
    // Never store OAuth callback query strings or account pages in the shell cache.
    event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>caches.match('./index.html')));return;
  }
  if(SHELL.some(path=>new URL(path,self.registration.scope).href===url.href))
    event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));
});
