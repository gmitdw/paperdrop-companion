const CACHE='paperdrop-shell-cee9ce4a657c4996';
const SHELL=['./','./index.html','./style.css','./app.js','./config.json','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('paperdrop-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'){
    // Never store OAuth callback query strings or account pages in the shell cache.
    event.respondWith(fetch(event.request).catch(()=>caches.match('./index.html')));return;
  }
  if(SHELL.some(path=>new URL(path,self.registration.scope).href===url.href))
    event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));
});
