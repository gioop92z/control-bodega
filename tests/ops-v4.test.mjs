import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizePickDraft,compareLocationQuantities} from '../operations-v4.mjs';

test('preparation saves repeated physical scans as quantities without dropping distinct SKUs',()=>{
  const rows=normalizePickDraft([{code:'UPC0001',quantity:1},{code:'UPC0001',quantity:1},{code:'SKU0002',quantity:2}]);
  assert.deepEqual(rows,[{code:'UPC0001',quantity:2},{code:'SKU0002',quantity:2}]);
});
test('rejects invalid manual quantities rather than silently changing stock',()=>{
  assert.deepEqual(normalizePickDraft([{code:'A',quantity:0},{code:'B',quantity:-1},{code:'C',quantity:1.5},{code:'D',quantity:4}]),[{code:'D',quantity:4}]);
});
test('keeps location unknown separate from zero quantity',()=>{
  assert.deepEqual(compareLocationQuantities(50,[{cantidad:20},{cantidad:null}]),{located:20,unknown:true,difference:null});
  assert.deepEqual(compareLocationQuantities(50,[{cantidad:20},{cantidad:10}]),{located:30,unknown:false,difference:20});
});
test('normalizer caps oversized and legacy drafts safely',()=>{
  const arr=Array.from({length:550},(_,i)=>({code:'S'+i,quantity:1}));
  assert.equal(normalizePickDraft(arr).length,500);
  assert.deepEqual(normalizePickDraft([{code:'A',quantity:99999},{code:'A',quantity:2}]),[{code:'A',quantity:100000}]);
});
test('new module is wired to the deployed entrypoint',async()=>{
  const [app,index]=await Promise.all([
    readFile(new URL('../app.js',import.meta.url),'utf8'),
    readFile(new URL('../index.html',import.meta.url),'utf8')
  ]);
  assert.match(app,/mountOperations\(/);
  assert.match(app,/S\.view==='operations'/);
  assert.match(index,/operations-v4\.css/);
});
