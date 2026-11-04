import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('VANTIS starts without obsolete tutorial scripts or bottom navigation',()=>{
  const html=read('index.html');
  const app=read('app.js');
  const legacy=read('nova-enhancements.js');
  assert.doesNotMatch(html,/nova-tutorial-slides(?:\.js|\.css)/);
  assert.doesNotMatch(legacy,/injectTutorialTab|novaTutorialTab|const tutorials\s*=/);
  assert.doesNotMatch(app,/data-atab="onboarding"|id="quickReceive"|class="bottom-nav"/);
  assert.match(html,/vantis-command\.css\?v=5\.9\.0/);
  assert.match(html,/vantis-experience\.js\?v=5\.9\.0/);
  assert.match(app,/class="vc-dock"/);
  assert.match(app,/data-vc-action="receive"/);
  assert.match(app,/data-vc-action="exit"/);
});

test('command menu is keyboard-accessible and preserves guarded route transitions',()=>{
  const app=read('app.js');
  assert.match(app,/aria-expanded="false"/);
  assert.match(app,/aria-controls="vcPanel"/);
  assert.match(app,/aria-label="Centro de acciones VANTIS"/);
  assert.match(app,/if\(exitBusy\(\)\|\|receiveBusy\(\)\)return;/);
  assert.match(app,/event\.key==='Escape'/);
  assert.match(app,/commandOpen\(false,true\)/);
  assert.match(app,/S\.moveType='ENTRADA';fastReceiveView\(\)/);
  assert.match(app,/S\.moveType='SALIDA';S\.view='move';render\(\)/);
});

test('motion is performant, original and respects reduced motion',()=>{
  const css=read('vantis-command.css'),startup=read('vantis-experience.js');
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/\.vc-panel\[/);
  assert.match(css,/@keyframes vcCardIntro/);
  assert.match(css,/@keyframes vcIntroArrive/);
  assert.match(css,/\.vc-intro\{[^}]*pointer-events:none/s);
  assert.match(startup,/sessionStorage\.setItem\(key,'1'\)/);
  assert.match(startup,/!document\.querySelector\('\.vantis-session-gate,\.nova-identity-gate,#scanner'\)/);
  assert.match(startup,/reduced\(\)/);
  assert.doesNotMatch(startup,/new Audio|AudioContext|autoplay/);
});

test('existing receiving, scanner and inventory modules remain linked',()=>{
  const html=read('index.html'),app=read('app.js');
  for(const file of ['scan-evidence.css','vantis-minimal-operations.css','scanner-pro.css','continuous-receive.css','app.js']){
    assert.ok(html.includes(file),file+' must remain linked');
  }
  for(const name of ['ContinuousReceive','mountContinuousReceive','ScanEvidence','FastExitQueue','render()','fastReceiveView()']){
    assert.ok(app.includes(name),name+' must remain reachable');
  }
});
