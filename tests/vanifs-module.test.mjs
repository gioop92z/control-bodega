import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const portal = readFileSync(new URL('../vanifs.html', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../vantis-command-hub.css', import.meta.url), 'utf8');

test('VANTIS keeps inventory and adds a visible VANIFS entry in both navigation and home', () => {
  assert.match(app, /createClient\(/);
  assert.match(app, /data-act="ENTRADA"/);
  assert.equal((app.match(/href="\.\/vanifs\.html"/g) || []).length, 2);
  assert.match(app, /VANIFS · Recepción en equipo/);
  assert.match(app, /VANIFS · Recepción<\/b>/);
  assert.match(css, /\.vanifs-link/);
});

test('VANIFS opens the existing collaborative service without migrating inventory', () => {
  const url = 'https://vanifs-recepcion-mercancia.toastysparrow.chatgpt.site/';
  assert.ok(portal.includes(url));
  assert.match(portal, /Cámara y lector/);
  assert.match(portal, /iframe id="reception-frame"/);
  assert.match(portal, /allow="camera;/);
  assert.match(portal, /Abrir en pantalla completa/);
  assert.match(portal, /Ningún manifiesto ni lectura de VANIFS modifica automáticamente las existencias/);
  assert.ok(!portal.includes('service_role'));
  assert.ok(!portal.includes('vanifs_api'));
  assert.ok(!portal.includes('supabase.co'));
});

test('VANTIS loads cache-busted navigation and does not redirect every user automatically', () => {
  assert.match(index, /app\.js\?v=5\.12\.1/);
  assert.match(index, /vantis-command-hub\.css\?v=5\.12\.1/);
  assert.match(portal, /id="show-embedded"/);
  assert.match(portal, /id="open-reception"/);
  assert.match(portal, /href="\.\/"/);
});