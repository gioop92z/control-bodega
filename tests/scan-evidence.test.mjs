import test from 'node:test';
import assert from 'node:assert/strict';
import {EVIDENCE_BUCKET,evidencePath,listSkuEvidence} from '../scan-evidence.mjs';

const uuid1='11111111-1111-4111-8111-111111111111';
const uuid2='22222222-2222-4222-8222-222222222222';
const uuid3='33333333-3333-4333-8333-333333333333';

test('private evidence filenames are deterministic per scan event',()=>{
  assert.equal(EVIDENCE_BUCKET,'vantis-evidencias');
  assert.equal(evidencePath(uuid1,uuid2,uuid3),uuid1+'/'+uuid2+'/'+uuid3+'.jpg');
  assert.throws(()=>evidencePath('../',uuid2,uuid3),/no válido/);
  assert.throws(()=>evidencePath(uuid1,uuid2,''),/no válido/);
});

test('SKU photo listing uses department scope and short-lived signed links',async()=>{
  const calls=[],entry={evento_id:uuid3,capturada_en:'2026-10-22T16:15:00Z',codigo_leido:'7501234',objeto_path:evidencePath(uuid1,uuid2,uuid3)};
  const query={
    select(value){calls.push(['select',value]);return this;},
    eq(name,value){calls.push(['eq',name,value]);return this;},
    order(name,value){calls.push(['order',name,value]);return this;},
    limit(value){calls.push(['limit',value]);return Promise.resolve({data:[entry],error:null});}
  };
  const client={
    from(name){assert.equal(name,'vantis_evidencias_escaneo');return query;},
    storage:{from(name){
      assert.equal(name,EVIDENCE_BUCKET);
      return {async createSignedUrl(path,seconds){calls.push(['signed',path,seconds]);return {data:{signedUrl:'https://signed.test/image?temporary=1'},error:null};}};
    }}
  };
  const photos=await listSkuEvidence(client,uuid1,'SKU-001',{limit:2});
  assert.equal(photos.length,1);
  assert.equal(photos[0].url,'https://signed.test/image?temporary=1');
  assert.deepEqual(calls.find(c=>c[0]==='signed'),['signed',entry.objeto_path,600]);
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='departamento_id'&&c[2]===uuid1));
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='sku'&&c[2]==='SKU-001'));
});

test('signed URL failure never makes a private photo public',async()=>{
  const query={select(){return this},eq(){return this},order(){return this},limit(){
    return Promise.resolve({data:[{evento_id:uuid3,objeto_path:evidencePath(uuid1,uuid2,uuid3)}],error:null});
  }};
  const client={from(){return query},storage:{from(){return {async createSignedUrl(){return {data:null,error:new Error('Denied')}}}}}};
  const [photo]=await listSkuEvidence(client,uuid1,'SKU-001');
  assert.equal(photo.url,'');
});
