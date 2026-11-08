import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createDatabase, dept, devices, event, marbete, people, row, scan, sku } from './helpers/vanifs-db.mjs';

const { db, as, rpc, create, append, close, end, engine } = await createDatabase();
after(end);
const stock = async () => Number((await db.query('SELECT stock FROM public.productos WHERE sku=$1',[sku])).rows[0].stock);
const detail = (id,i=0) => rpc(i,'receipt','detail',{id,after:0});
const pulse = (i,id,pending=0) => rpc(i,'team','pulse',{id,device:devices[i],pending});
const pause = id => rpc(0,'team','pause',{id,paused:true,device:devices[0]});
const rejected = code => error => error.code === code;

test('shared legacy identity and unapproved verified Gmail have no VANIFS access',async()=>{
  assert.equal(await rpc(6,'access','profile'),null);
  assert.equal(await rpc(7,'access','profile'),null);
  assert.equal((await rpc(0,'access','profile')).inventoryRole,'admin');
  await assert.rejects(rpc(null,'receipt','today'),rejected('42501'));
  await assert.rejects(rpc(6,'receipt','today'),rejected('42501'));
  await assert.rejects(as(1,'SELECT * FROM vanifs_private.events'),rejected('42501'));
  assert.equal(await stock(),37);
});

test('one supervisor import is visible on all four accounts and is deduplicated across retries',async()=>{
  const rows = [row('CAJA-PRUEBA-A',2),row('CAJA-PRUEBA-B',3)];
  const receipt=await create(rows,5,'Jornada supervisada');
  const copy=await create([...rows].reverse(),0,'Intento de reimportar');
  assert.equal(copy.id,receipt.id);
  assert.equal(copy.expected,5);
  await assert.rejects(create([row('NO-AUTORIZADO')],1),rejected('42501'));
  const views=await Promise.all([1,2,3,4].map(i=>rpc(i,'receipt','today')));
  assert.ok(views.every(view=>view.receipts.some(item=>item.id===receipt.id && item.live.totals.missing===5)));
  const other=await create([row('CAJA-PRUEBA-C',1)],5,'Segunda jornada');
  assert.notEqual(other.id,receipt.id);
});

test('invitation requires the verified matching email, role and authorization persist',async()=>{
  const j=await create([row('INVITACION')]);
  const invitation=await rpc(0,'team','invite',{id:j.id,email:'pruebas6@gmail.com',role:'collaborator',device:devices[0]});
  await assert.rejects(rpc(4,'access','join',{code:invitation.code,name:'Otra persona'}),rejected('42501'));
  const accepted=await rpc(6,'access','join',{code:invitation.code,name:'Cuenta invitada'});
  assert.equal(accepted.receiptId,j.id);
  await rpc(0,'team','remove',{id:j.id,userId:people[6]});
  await assert.rejects(detail(j.id,6),rejected('PT404'));
  assert.deepEqual((await as(6,'SELECT journey_id FROM public.vanifs_revisions WHERE journey_id=$1',[j.id])).rows,[]);
});

test('four operators capture 10,000 repeated-SKU pieces, with dropped-response retries and exact attribution',async t=>{
  const start=performance.now();
  const boxes=Array.from({length:4},(_,i)=>'BODEGA-QA-'+i);
  const receipt=await create(boxes.map(box=>row(box,2500)));
  const cases=boxes.map((box,index)=>({box,operator:index+1,ops:Array.from({length:2500},()=>scan('piece',sku,box))}));
  await Promise.all(cases.map(({box,operator})=>append(operator,receipt.id,[scan('box',box,box)])));
  const commitStart=performance.now();
  let retries=0;
  const latencies=[];
  await Promise.all(cases.map(async ({operator,ops})=>{
    let after=0;
    for(let cursor=0;cursor<ops.length;cursor+=100) {
      const batch=ops.slice(cursor,cursor+100);
      const sent=performance.now();
      const reply=await append(operator,receipt.id,batch,after);
      latencies.push(performance.now()-sent);
      assert.equal(reply.acks.length,batch.length);
      assert.ok(reply.acks.every(ack=>ack.result==='Recibida'));
      after=reply.receipt.revision;
      if(cursor%500===0) {
        const repeated=await append(operator,receipt.id,batch,after);
        assert.deepEqual(repeated.acks.map(ack=>[ack.id,ack.result]),reply.acks.map(ack=>[ack.id,ack.result]));
        retries+=batch.length;
      }
    }
  }));
  const finished=await detail(receipt.id);
  assert.equal(finished.live.totals.scanned,10000);
  assert.equal(finished.live.totals.matched,10000);
  assert.equal(finished.live.totals.missing,0);
  assert.equal(finished.live.processed,4);
  assert.deepEqual(finished.live.people.map(p=>p.pieces).sort(),[2500,2500,2500,2500]);
  const lines=await db.query('SELECT box,received FROM vanifs_private.lines WHERE journey_id=$1 ORDER BY box',[receipt.id]);
  assert.deepEqual(lines.rows.map(line=>[line.box,line.received]),boxes.map(box=>[box,2500]));
  const log=await db.query("SELECT count(*)::int AS n,count(DISTINCT id)::int AS unique FROM vanifs_private.events WHERE journey_id=$1 AND kind='piece'",[receipt.id]);
  assert.deepEqual(log.rows[0],{n:10000,unique:10000});
  assert.equal(await stock(),37);
  latencies.sort((a,b)=>a-b);
  t.diagnostic(JSON.stringify({engine,scans:10000,retries,batches:latencies.length,confirmed:10000,duplicates:0,
    commitWallMs:Math.round(performance.now()-commitStart),p95BatchMs:Math.round(latencies[Math.ceil(latencies.length*.95)-1]),totalMs:Math.round(performance.now()-start)}));
});

test('per-device box selection, wrong box, unknown SKU, and rejected payload reuse retain original evidence',async()=>{
  const upc='0012345678905';
  const j=await create([row('CAMBIO-1',2),{...row('CAMBIO-2',2),upc},row('CAMBIO-3',2,'SKU-DE-OTRA-CAJA')]);
  await Promise.all([
    append(1,j.id,[scan('box','CAMBIO-1','CAMBIO-1')]),
    append(2,j.id,[scan('box','CAMBIO-2','CAMBIO-2')]),
  ]);
  await assert.rejects(append(2,j.id,[scan('piece',sku,'CAMBIO-1')]),rejected('22023'));
  const valid=scan('piece',upc,'CAMBIO-2');
  const recorded=await append(2,j.id,[valid]);
  const retried=await append(2,j.id,[valid]);
  assert.equal(recorded.acks[0].sku,sku);
  assert.deepEqual(retried.acks,recorded.acks);
  await assert.rejects(append(2,j.id,[{...valid,source:'Manual'}]),rejected('PT409'));
  const a=await append(1,j.id,[scan('piece','SKU-DE-OTRA-CAJA','CAMBIO-1'),scan('piece','DESCONOCIDO','CAMBIO-1')]);
  assert.deepEqual(a.acks.map(x=>x.result),['Otra caja','Fuera de manifiesto']);
  await append(1,j.id,[scan('box','CAMBIO-3','CAMBIO-3'),scan('piece','SKU-DE-OTRA-CAJA','CAMBIO-3')]);
  const live=(await detail(j.id)).live;
  assert.equal(live.totals.matched,2);
  assert.equal(live.totals.wrongBox,1);
  assert.equal(live.totals.unknown,1);
  assert.equal((await detail(j.id,2)).batches.flatMap(b=>b.ops).every(op=>op.actor.id===people[2]),true);
});

test('closure waits for reported outboxes, records incidents and reopens without dropping late events',async()=>{
  const j=await create([row('CIERRE-1',2)]);
  await append(1,j.id,[scan('box','CIERRE-1','CIERRE-1'),scan('piece',sku,'CIERRE-1')]);
  const opened=(await detail(j.id)).receipt;
  await pulse(1,j.id,1);
  await assert.rejects(close(0,opened),rejected('PT409'));
  await pause(j.id);
  await pulse(1,j.id,0);
  await assert.rejects(close(1,opened),rejected('42501'));
  await assert.rejects(close(0,opened,{note:''}),rejected('PT409'));
  const ended=(await close(0,opened)).receipt;
  assert.equal(ended.totals.missing,1);
  const late=scan('piece',sku,'CIERRE-1');
  await assert.rejects(append(1,j.id,[late]),rejected('PT409'));
  await rpc(0,'receipt','reopen',{id:j.id,note:'Recuperación de lecturas de un teléfono',device:devices[0]});
  const reply=await append(1,j.id,[late]);
  assert.equal(reply.acks[0].result,'Recibida');
  assert.equal((await detail(j.id)).live.totals.matched,2);
  const {activities}=await rpc(0,'team','audit',{id:j.id});
  assert.ok(activities.some(entry=>entry.action==='Reabrió jornada'));
  assert.ok(activities.some(entry=>entry.action==='Cerró jornada'));
});

test('corrections are append-only and a supervisor can authorize stock transfer only once after close',async()=>{
  const j=await create([row('',1)]);
  const first=scan('piece',sku,'');
  const next=scan('piece',sku,'');
  const batch=await append(1,j.id,[first,next]);
  assert.deepEqual(batch.acks.map(x=>x.result),['Recibida','Sobrante']);
  await assert.rejects(append(2,j.id,[event('undo',{target:first.id})]),rejected('PT409'));
  await append(0,j.id,[event('undo',{target:first.id})]);
  const changed=await detail(j.id);
  assert.equal(changed.live.totals.scanned,1);
  assert.equal(changed.live.totals.matched,1);
  assert.equal(changed.batches.flatMap(batch=>batch.ops).length,3);
  const input={id:j.id,sku,department:dept,marbete};
  await assert.rejects(rpc(0,'receipt','transfer',input),rejected('22023'));
  await pause(j.id);
  await pulse(1,j.id,0);
  await close(0,changed.receipt);
  await assert.rejects(rpc(5,'receipt','transfer',input),rejected('42501'));
  const confirmed=await Promise.all([rpc(0,'receipt','transfer',input),rpc(0,'receipt','transfer',input)]);
  assert.equal(confirmed[0].id,confirmed[1].id);
  assert.equal(await stock(),38);
  assert.equal(Number((await db.query('SELECT count(*) FROM public.movimientos WHERE id=$1',[confirmed[0].id])).rows[0].count),1);
  await assert.rejects(rpc(0,'receipt','reopen',{id:j.id,note:'Cambiar conteo',device:devices[0]}),rejected('PT409'));
});

test('legacy backup migration is lossless and replayable without granting public access',async()=>{
  const backupPath=process.env.VANIFS_ARCHIVE_TEST_FILE;
  let source;
  if (backupPath) {
    const bytes=await readFile(backupPath);
    source=JSON.parse((backupPath.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString());
  } else {
    const id=crypto.randomUUID();
    const timestamp='2026-10-31T16:00:00Z';
    source={format:'vanifs-d1-v2',receipts:[{id,title:'Archivo previo',file:'anterior.csv',created_at:timestamp,created_by:'Operador anterior',
      closed_at:timestamp,closed_by:'Operador anterior',line_count:1,expected:1}],manifest_blocks:[{receipt_id:id,position:0,rows:JSON.stringify([row()])}],
      operation_batches:[{receipt_id:id,seq:1,ops:JSON.stringify([{...scan('piece',sku,''),actor:{id:'legacy',name:'Operador anterior'}}])}],team_activity:[]};
  }
  const statement='SELECT vanifs_private.import_d1_archive($1::jsonb) AS outcome';
  const count=source.operation_batches.reduce((sum,batch)=>sum+JSON.parse(batch.ops).length,0);
  const [actual,replay]=await Promise.all([db.query(statement,[JSON.stringify(source)]),db.query(statement,[JSON.stringify(source)])]);
  const results=[actual.rows[0].outcome,replay.rows[0].outcome];
  assert.ok(results.some(result=>result.duplicate));
  assert.ok(results.some(result=>result.events===count && result.journeys===source.receipts.length));
  const stored=(await db.query("SELECT source FROM vanifs_private.legacy_backups")).rows[0].source;
  assert.deepEqual(stored,source);
  for(const j of source.receipts) {
    const view=await detail(j.id);
    assert.equal(view.receipt.archived,true);
    assert.equal(view.receipt.expected,Number(j.expected));
    assert.equal(view.receipt.closedBy,j.closed_by);
  }
  await assert.rejects(as(0,statement,[JSON.stringify(source)]),rejected('42501'));
});
