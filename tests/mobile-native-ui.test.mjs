import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('mobile optimization loads last and legacy motion observer is disabled',()=>{
  const html=read('index.html');
  assert.match(html,/viewport-fit=cover/);
  assert.ok(html.indexOf('vantis-mobile-native.css')>html.indexOf('vantis-boot.css'));
  assert.doesNotMatch(html,/src="vantis-motion\.js/);
  assert.match(html,/app\.js\?v=/);
  assert.match(html,/vantis-enterprise\.js\?v=/);
});

test('iPhone Safari retains accessible zoom, safe area and touch targets',()=>{
  const html=read('index.html'),css=read('vantis-mobile-native.css');
  assert.doesNotMatch(html,/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  assert.match(css,/-webkit-tap-highlight-color:transparent/);
  assert.match(css,/touch-action:manipulation/);
  assert.match(css,/font-size:16px!important/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/height:100dvh/);
  assert.match(read('vantis-minimal-operations.css'),/safe-area-inset-bottom/);
});

test('animation-performance removes high-frequency motion but retains scanner confirmation',()=>{
  const css=read('vantis-mobile-native.css');
  assert.match(css,/\.view-enter,\.product-row,\.history-row,\.kpi/);
  assert.match(css,/animation:none!important/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/translate3d\(calc\(var\(--vantis-swipe\)\*14px\),0,0\)/);
  assert.match(read('vantis-minimal-operations.css'),/scanner-detected/);
  assert.match(read('scanner.js'),/scannerReceipt/);
});

test('navigation is immediate and gestures cannot conflict with camera, dialogs or Safari back',()=>{
  const js=read('vantis-enterprise.js');
  assert.doesNotMatch(js,/startViewTransition|setTimeout\(cleanupTransition/);
  assert.match(js,/handler\.call\(button\|\|null\)/);
  assert.match(js,/#scanner/);
  assert.match(js,/\[role="dialog"\]/);
  assert.match(js,/t\.clientX<24/);
});

test('break UI protects long codes, narrow viewports and horizontal lists',()=>{
  const css=read('vantis-mobile-native.css');
  assert.match(css,/overflow-wrap:anywhere/);
  assert.match(css,/max-width:370px/);
  assert.match(css,/overscroll-behavior-x:contain/);
  assert.match(css,/\.table-scroll\{max-width:100%\}/);
});
