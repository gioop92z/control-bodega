import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('team.html'),css=read('vantis-team-next.css'),js=read('vantis-team.mjs');
test('the upgraded interface is VANTIS Equipo, not legacy index',()=>{
 assert.match(html,/<body class="vantis-team-next">/);
 assert.match(html,/vantis-team-next\.css\?v=5\.17\.0/);
 assert.match(html,/vantis-team\.mjs\?v=5\.17\.0/);
 assert.match(html,/Base central · acceso seguro/);
});
test('fast actions delegate to existing guarded receive and outbound modes',()=>{
 for(const id of ['teamQuickSearch','teamQuickReceive','teamQuickOutbound'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(js,/teamQuickVisibility\(profile\.role!=='viewer'\)/);
 assert.match(js,/button\.click\(\); \/\/ Usa las validaciones originales/);
 assert.match(js,/if\(!button\.classList\.contains\('active'\)\)/);
 assert.match(js,/teamQuickSelect\(mode\)/);
});
test('no changes to identity, shared inventory client or scan queue',()=>{
 assert.match(js,/openTeamSession\(employee,pin\)/);
 assert.match(js,/api=new TeamInventoryApi/);
 assert.match(js,/new ContinuousReceive\(/);
 assert.match(js,/mountOutbound\(/);
 assert.match(js,/queue\?\.pending/);
});
test('mobile native + performance + reduced motion',()=>{
 assert.match(html,/viewport-fit=cover/);
 assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/);
 for(const t of ['-webkit-tap-highlight-color:transparent','touch-action:manipulation','font-size:16px!important','min-height:44px','height:100dvh!important','prefers-reduced-motion:reduce'])assert.ok(css.includes(t),t);
 assert.match(css,/\.scanner-laser\{display:none!important;animation:none!important\}/);
 assert.doesNotMatch(css,/transition:\s*all|animation:[^;\n]*infinite/);
});
test('break UI for long codes and small screen',()=>{
 for(const t of ['overflow-wrap:anywhere','max-width:370px','forced-colors:active','scroll-margin-top:calc'])assert.ok(css.includes(t),t);
});
