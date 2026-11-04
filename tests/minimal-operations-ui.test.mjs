import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url),'utf8');

test('published HTML loads minimal operations style after legacy scanner/receiving styles',()=>{
  const page=read('index.html');
  const idx=name=>page.indexOf(name);
  for(const file of ['scanner-pro.css','continuous-receive.css','floating-receive.css','vantis-minimal-operations.css']){
    assert.ok(idx(file)>0, file+' missing from index');
  }
  assert.ok(idx('vantis-minimal-operations.css')>idx('scanner-pro.css'));
  assert.ok(idx('vantis-minimal-operations.css')>idx('floating-receive.css'));
  assert.ok(idx('vantis-minimal-operations.css')>idx('continuous-receive.css'));
});

test('camera scan frame is static, and camera feedback stays functional',()=>{
  const css=read('vantis-minimal-operations.css');
  const scanner=read('scanner.js');
  assert.match(css, /\.scanner-laser\s*\{\s*display:none!important;animation:none!important/);
  assert.match(css, /\.scanner-live span\s*\{[^}]*animation:none!important/s);
  assert.match(css, /#scanner\.scanner-pro\.scanner-detected \.scanner-target/);
  assert.match(scanner, /navigator\.vibrate\?\.\(/);
  assert.match(scanner, /scannerReceipt/);
  assert.match(scanner, /document\.body\.classList\?\.add\('vantis-scanner-open'\)/);
  assert.match(scanner, /stopScanner\(\)/);
});

test('receiving capture has single surface and separate pending/server indication',()=>{
  const css=read('vantis-minimal-operations.css');
  assert.match(css,/\.continuous-receive \.cr-stage\s*\{/);
  assert.match(css,/background:#fff!important/);
  assert.match(css,/#crSync\[data-connection="checking"\]/);
  assert.match(css,/#crSync\[data-connection="offline"\]/);
  assert.match(css,/#crSync\[data-connection="pending"\]/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
