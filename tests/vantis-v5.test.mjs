import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {telemetrySnapshot,startMetric,serverMetric,scanMetric} from '../vantis-telemetry-v5.mjs';
import {InventoryJournalMirror} from '../vantis-offline-idb-v5.mjs';

test('diagnostics separate scanned pieces from backend responses',()=>{
 const before=telemetrySnapshot();
 scanMetric();serverMetric(startMetric(),true);serverMetric(startMetric(),false);
 const after=telemetrySnapshot();
 assert.ok(after.perMinute>=before.perMinute+1);
 assert.ok(after.requests>=2);
 assert.ok(after.errors>=1);
 assert.ok(after.latencyMs!==null);
});
test('IndexedDB mirror safely degrades without browser database support',async()=>{
 const mirror=new InventoryJournalMirror('vantis-test-scope');
 mirror.queue('row','a',{id:'a',status:'queued'});
 const s=await mirror.status();
 assert.equal(s.available,false);
 assert.deepEqual(await mirror.readRows('any'),[]);
 await mirror.dispose();
});
test('cyclic counting is permission-gated and never changes stock automatically',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261022231000_vantis_ciclos_supervisados_incidencias_v5.sql',import.meta.url),'utf8');
 assert.match(sql,/vantis_core\.role_for\(p_departamento\).*'admin'/s);
 assert.match(sql,/vantis_core\.role_for\(c\.departamento_id\).*'admin'/s);
 assert.match(sql,/c\.estado<>'EN_REVISION'/);
 assert.doesNotMatch(sql,/update\s+public\.productos\s+set\s+stock/i);
 assert.doesNotMatch(sql,/update\s+public\.producto_marbetes/i);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/i);
});
test('four modules are reachable in VANTIS main interface',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const ops=readFileSync(new URL('../operations-v4.mjs',import.meta.url),'utf8');
 const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(app,/getReceiveStatus:/);
 for(const name of ['diagnostics','cycles','incidents'])assert.ok(ops.includes("'"+name+"'"));
 assert.match(index,/vantis-v5\.css/);
});
