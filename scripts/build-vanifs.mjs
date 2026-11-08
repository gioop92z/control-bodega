import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outdir = 'vanifs/build';
const result = await build({
  entryPoints: { module: 'vanifs/app/entry.tsx' },
  outdir, bundle: true, format: 'esm', platform: 'browser',
  splitting: true, minify: true, target: ['safari16', 'chrome109'],
  jsx: 'automatic', metafile: true, chunkNames: 'chunks/[name]-[hash]',
  define: {
    'process.env.NODE_ENV': '"production"',
    __VANIFS_DRIVE_CONFIG__: JSON.stringify({
      clientId: process.env.VANIFS_GOOGLE_CLIENT_ID || '',
      apiKey: process.env.VANIFS_GOOGLE_PICKER_KEY || '',
      appId: process.env.VANIFS_GOOGLE_PROJECT_NUMBER || '',
    }),
  },
});
const assets = Object.keys(result.metafile.outputs).map(path => './' + path.slice('vanifs/'.length));
const version = createHash('sha256').update(JSON.stringify(result.metafile)).digest('hex').slice(0, 12);
await mkdir(resolve(outdir), { recursive: true });
await writeFile(resolve('vanifs/vanifs-sw.generated.js'), `
const root = new URL('./', self.location.href);
const key = 'vanifs-module-' + ${JSON.stringify(version)};
const files = new Set(${JSON.stringify(['./index.html', './vanifs.css', './vanifs-wordmark.svg', ...assets])}.map(path => new URL(path, root).href));
self.addEventListener('install', event => event.waitUntil(caches.open(key).then(cache => cache.addAll([...files])).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys
  .filter(name => name.startsWith('vanifs-module-') && name !== key).map(name => caches.delete(name)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== root.origin) return;
  const entry = url.pathname === root.pathname || url.pathname === root.pathname + 'index.html';
  if (entry && event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.open(key).then(cache => cache.match(new URL('index.html', root).href))));
    return;
  }
  if (files.has(url.href)) {
    event.respondWith(caches.open(key).then(async cache => {
      const cached = await cache.match(event.request);
      return cached || fetch(event.request);
    }));
  }
});
`);
console.log('VANIFS browser bundle built', version);
