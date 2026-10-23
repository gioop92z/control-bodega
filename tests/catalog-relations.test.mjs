import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogCandidate,confirmCatalogCandidate,rejectCatalogCandidate} from '../catalog-relations.mjs';
const mem=new Map();
globalThis.localStorage={getItem:k=>mem.get(k)||null,setItem:(k,val)=>mem.set(k,String(val))};
test('SKU hijo muestra foto del catálogo padre únicamente como candidato',()=>{
 mem.clear();
 const item=catalogCandidate(['1180029415']);
 assert.equal(item?.status,'candidate');
 assert.equal(item?.liverpoolCode,'1180029353');
 assert.match(item.imageUrl,/^https:\/\/ss405\.liverpool\.com\.mx\/xl\/1180029353\.jpg$/);
 assert.equal(catalogCandidate(['1180029999']),null);
});
test('confirmación explícita conserva asociación sin tocar stock',()=>{
 mem.clear();
 const item=catalogCandidate(['1180029415']);
 assert.equal(confirmCatalogCandidate('1180029415',item),true);
 const stored=catalogCandidate(['1180029415']);
 assert.equal(stored.status,'operator_confirmed');
 assert.equal(stored.title,item.title);
 assert.equal(stored.liverpoolCode,'1180029353');
});
test('rechazar un modelo similar impide reutilizar automáticamente la foto',()=>{
 mem.clear();rejectCatalogCandidate('1180029415');
 assert.equal(catalogCandidate(['1180029415']),null);
});
test('no vincula un URL ajeno o un código distinto',()=>{
 mem.clear();
 const item=catalogCandidate(['1180029415']);
 assert.equal(confirmCatalogCandidate('1180029999',item),false);
 assert.equal(confirmCatalogCandidate('1180029415',{...item,imageUrl:'https://example.org/untrusted.jpg'}),false);
});

test('SKU 1180031266 muestra automáticamente la ficha genérica 1180031226 sin tocar stock',()=>{
  mem.clear();
  const item=catalogCandidate(['1180031266']);
  assert.equal(item.status,'family_reference');
  assert.equal(item.liverpoolCode,'1180031226');
  assert.equal(item.brand,'ELEFANTE');
  assert.equal(item.title,'Zapato Mary Jane Mila de piel para niña');
  assert.equal(item.imageUrl,'https://ss405.liverpool.com.mx/xl/1180031226.jpg');
  assert.equal(item.sizeVerified,false);
});
