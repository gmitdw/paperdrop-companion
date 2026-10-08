import {build} from 'esbuild';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
await build({entryPoints:['src/app.js'],bundle:true,format:'esm',target:'safari16',outfile:'dist/app.js'});
await copyFile('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','dist/pdf-worker-6.4.299.mjs');
const hash=createHash('sha256');
for(const file of ['app.js','style.css','index.html','config.json','manifest.webmanifest'])hash.update(await readFile('dist/'+file));
const version=hash.digest('hex').slice(0,16);
const sw=(await readFile('dist/sw.js','utf8')).replace(/const CACHE='[^']+';/,`const CACHE='paperdrop-shell-${version}';`);
await writeFile('dist/sw.js',sw);
// Versioned asset URLs avoid mixing a new page with an older installed shell.
for (const file of ['app.js','style.css']) await writeFile('dist/'+file.replace('.', '-'+version+'.'),await readFile('dist/'+file));
let html=await readFile('dist/index.html','utf8');
html=html.replace(/app(?:-[a-f0-9]{16})?\.js/g,'app-'+version+'.js').replace(/style(?:-[a-f0-9]{16})?\.css/g,'style-'+version+'.css');
await writeFile('dist/index.html',html);
let shell=await readFile('dist/sw.js','utf8');
shell=shell.replace(/'\.\/app(?:-[a-f0-9]{16})?\.js'/g,"'./app-"+version+".js'").replace(/'\.\/style(?:-[a-f0-9]{16})?\.css'/g,"'./style-"+version+".css'");
await writeFile('dist/sw.js',shell);
console.log('Built PaperDrop shell '+version);
