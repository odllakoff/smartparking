require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn, fork } = require('node:child_process');
const { createServer } = require('node:net');
const { mkdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Pool } = require('pg');
const { BusinessService } = require('../dist/business/service');
const { PgBusinessRepository } = require('../dist/business/repository');
const { OutboxDispatcher } = require('../dist/audit/outbox');
const { HttpEventPublisher } = require('../dist/audit/publisher');
const { createApp } = require('../dist/http/app');

async function until(check,message) {
  const deadline = Date.now()+15000;
  while (Date.now()<deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve,50)); }
  throw new Error(message);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => { child.once('exit',resolve); child.kill(); });
}
function messageFrom(child,phase) {
  return new Promise((resolve,reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout esperando ${phase}`)),15000);
    child.once('error',error => { clearTimeout(timeout); reject(error); });
    child.on('message',message => {
      if (message.error) { clearTimeout(timeout); reject(new Error(message.error)); }
      if (message.phase === phase) { clearTimeout(timeout); resolve(message); }
    });
    child.once('exit',() => { clearTimeout(timeout); reject(new Error(`Proceso terminó antes de ${phase}`)); });
  });
}
async function unusedPort() {
  const server = createServer(); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

test('outbox durable: transacciones, interrupciones reales, recuperación y concurrencia',async t => {
  // Base efímera para no detener ni alterar la demo de PM2 durante los ensayos de caída.
  const dbName = 'sp_outbox_test_'+randomUUID().replaceAll('-','');
  const admin = new Pool({ connectionString:process.env.BUSINESS_DATABASE_URL,max:1 });
  const dbUrl = new URL(process.env.BUSINESS_DATABASE_URL); dbUrl.pathname='/'+dbName;
  let pool,receiver,worker,crash,api;
  const port = await unusedPort();
  const auditFile = path.resolve('tmp',dbName,'audit.sqlite');
  const env = { ...process.env,BUSINESS_DATABASE_URL:dbUrl.toString(),AUDIT_URL:`http://127.0.0.1:${port}`,
    AUDIT_PORT:String(port),AUDIT_FILE:auditFile,OUTBOX_POLL_MS:'50' };
  const launch = file => spawn(process.execPath,[file],{ env,stdio:'ignore' });
  const startReceiver = async () => {
    receiver=launch('dist/audit/main.js');
    await until(async () => { try { return (await fetch(env.AUDIT_URL+'/health')).ok; } catch { return false; } },'El receptor no inició');
  };
  const logCount = eventId => {
    const log = new DatabaseSync(auditFile,{ readOnly:true });
    try { return log.prepare('SELECT count(*) AS n FROM events WHERE event_id=?').get(eventId).n; }
    finally { log.close(); }
  };
  const eventFor = async entityId => (await pool.query("SELECT * FROM integration.outbox WHERE payload->>'entidadId'=$1",[entityId])).rows[0];
  const delivered = async entityId => Boolean((await eventFor(entityId))?.delivered_at);
  try {
    // El identificador se genera aquí y cumple una forma fija; nunca se acepta un nombre externo.
    assert.match(dbName,/^sp_outbox_test_[a-f0-9]{32}$/);
    await admin.query(`CREATE DATABASE ${dbName}`);
    pool = new Pool({ connectionString:dbUrl.toString(),max:5 });
    await pool.query(await readFile('sql/business.sql','utf8'));
    await mkdir(path.dirname(auditFile),{ recursive:true });
    const actor = { userId:randomUUID(),role:'CLIENTE' },clienteId=randomUUID();
    await pool.query('INSERT INTO clientes VALUES ($1,$2,$3,$4,$5)',[clienteId,'Outbox test',`${clienteId}@test.local`,'123',actor.userId]);
    const repo = new PgBusinessRepository(pool),service = new BusinessService(repo,{});
    const create = matricula => service.createVehiculo(actor,{ matricula,marca:'Test',modelo:'Outbox' });
    const http = new HttpEventPublisher(env.AUDIT_URL,env.AUDIT_SECRET);

    await t.test('si falla guardar el evento, se revierte el negocio',async () => {
      await pool.query(`CREATE FUNCTION integration.reject_event() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'fallo de outbox provocado por prueba'; END $$;
        CREATE TRIGGER reject_event BEFORE INSERT ON integration.outbox FOR EACH ROW EXECUTE FUNCTION integration.reject_event()`);
      try {
        await assert.rejects(create('ROLLBACK-OUTBOX'),/fallo de outbox/);
        assert.equal((await pool.query("SELECT 1 FROM vehiculos WHERE matricula='ROLLBACK-OUTBOX'")).rowCount,0);
        assert.equal((await pool.query('SELECT 1 FROM integration.outbox')).rowCount,0);
      } finally { await pool.query('DROP TRIGGER reject_event ON integration.outbox; DROP FUNCTION integration.reject_event()'); }
    });
    await t.test('rollback posterior a guardar ambos no deja evento huérfano',async () => {
      const id=randomUUID(),eventId=randomUUID();
      await assert.rejects(repo.transaction(async (r,events) => {
        await r.saveVehiculo({ id,matricula:'ROLLBACK-BOTH',marca:'Test',modelo:'Test',clienteId },true);
        await events.publish({ eventId,tipo:'ALTA',entidad:'Vehiculo',entidadId:id,userId:actor.userId,fechaHora:new Date().toISOString() });
        throw new Error('abortar ambos');
      }),/abortar ambos/);
      assert.equal(await repo.vehiculo(id),undefined);
      assert.equal((await pool.query('SELECT 1 FROM integration.outbox WHERE event_id=$1',[eventId])).rowCount,0);
    });
    await t.test('caída real después del commit: otro proceso entrega el pendiente',async () => {
      crash=fork('tests/fixtures/outbox-crash.cjs',[],{ env,stdio:['ignore','ignore','ignore','ipc'] });
      const message=messageFrom(crash,'committed'); crash.send({ mode:'commit',actor,matricula:'CRASH-AFTER-COMMIT' });
      const result=await message; await stop(crash); crash=undefined;
      const pending=await eventFor(result.entityId);
      assert.ok(await repo.vehiculo(result.entityId)); assert.equal(pending.delivered_at,null);
      await startReceiver(); worker=launch('dist/audit/worker.js');
      await until(() => delivered(result.entityId),'El worker reiniciado no entregó el evento confirmado');
      assert.equal(logCount(pending.event_id),1); await stop(worker); worker=undefined;
    });
    await t.test('auditoría caída: API confirma alta, reintento persiste y sobrevive reinicio',async () => {
      await stop(receiver); receiver=undefined;
      // API real, con identidad de prueba: las pruebas generales cubren el JWT real.
      api=createApp(service,{ validate:() => actor }).listen(0,'127.0.0.1');
      await new Promise(resolve => api.once('listening',resolve));
      const response=await fetch(`http://127.0.0.1:${api.address().port}/api/vehiculos`,{ method:'POST',
        headers:{ 'Content-Type':'application/json',Authorization:'Bearer identidad-de-prueba' },
        body:JSON.stringify({ matricula:'RECEIVER-DOWN',marca:'Test',modelo:'Test' }) });
      assert.equal(response.status,201); const vehicle=await response.json();
      worker=launch('dist/audit/worker.js');
      await until(async () => (await eventFor(vehicle.id)).attempts>=1,'No se persistió el intento fallido');
      await stop(worker); worker=undefined;
      const failed=await eventFor(vehicle.id);
      assert.equal(failed.delivered_at,null); assert.ok(failed.last_error); assert.ok(failed.next_attempt_at);
      await startReceiver(); worker=launch('dist/audit/worker.js');
      await until(() => delivered(vehicle.id),'No recuperó el evento pendiente tras reiniciar');
      assert.ok((await eventFor(vehicle.id)).attempts>=2); assert.equal(logCount(failed.event_id),1);
      await stop(worker); worker=undefined;
      await new Promise(resolve => api.close(resolve)); api=undefined;
    });
    await t.test('caída tras persistir en receptor y antes de marcar entrega: deduplica',async () => {
      const vehicle=await create('CRASH-AFTER-ACK');
      crash=fork('tests/fixtures/outbox-crash.cjs',[],{ env,stdio:['ignore','ignore','ignore','ipc'] });
      const message=messageFrom(crash,'persisted'); crash.send({ mode:'delivery' });
      const result=await message;
      assert.equal(logCount(result.eventId),1);
      await stop(crash); crash=undefined;
      assert.equal((await eventFor(vehicle.id)).delivered_at,null);
      const restarted=new OutboxDispatcher(pool,http);
      await restarted.dispatchOne();
      assert.ok(await delivered(vehicle.id)); assert.equal(logCount(result.eventId),1);
    });
    await t.test('dos publicadores concurrentes toman eventos diferentes',async () => {
      const a=await create('CONCURRENT-A'),b=await create('CONCURRENT-B');
      const ids=[]; let release,both;
      const gate=new Promise(resolve => release=resolve),ready=new Promise(resolve => both=resolve);
      const transport={ publish:async event => { ids.push(event.eventId); if (ids.length===2) both(); await gate; } };
      const first=new OutboxDispatcher(pool,transport).dispatchOne();
      const second=new OutboxDispatcher(pool,transport).dispatchOne();
      const timeout=setTimeout(both,5000);
      try { await ready; assert.equal(ids.length,2); assert.equal(new Set(ids).size,2); }
      finally { clearTimeout(timeout); release(); await Promise.all([first,second]); }
      assert.ok(await delivered(a.id)); assert.ok(await delivered(b.id));
    });
  } finally {
    await stop(crash); await stop(worker); await stop(receiver);
    if (api) await new Promise(resolve => api.close(resolve));
    if (pool) await pool.end();
    // Solo se elimina la base efímera creada por esta prueba, nunca la de demostración.
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});
