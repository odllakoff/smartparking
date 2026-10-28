require('dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const base = process.env.API_BASE || 'http://127.0.0.1:3000';
async function request(path, token, method = 'GET', body) {
  const response = await fetch(base+'/api'+path,{ method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer '+token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: response.status === 204 ? null : await response.json(), pid: response.headers.get('x-worker-pid') };
}
async function login(email) {
  const r = await request('/auth/login',null,'POST',{ email,password: process.env.DEMO_PASSWORD }); assert.equal(r.status,200); return r.data.accessToken;
}
test('integración real: CRUD, autorización, carreras entre workers y auditoría', async t => {
  const db = new Pool({ connectionString: process.env.BUSINESS_DATABASE_URL });
  const admin = await login('admin@demo.local'), a = await login('cliente1@demo.local'), b = await login('cliente2@demo.local');
  const ca = (await request('/auth/me',a)).data.cliente, cb = (await request('/auth/me',b)).data.cliente;
  let vehicleId, temporaryClient, temporaryIdentity;
  const pids = new Set();
  try {
    await t.test('401 sin token, 403 consulta global y CRUD de clientes', async () => {
      assert.equal((await request('/reservas')).status,401);
      assert.equal((await request('/admin/reservas',a)).status,403);
      assert.equal((await request('/clientes',a)).status,403);
      const email = `test-${randomUUID()}@demo.local`;
      const user = await request('/auth/users',admin,'POST',{ email,password: 'Integration-123!' }); assert.equal(user.status,201); temporaryIdentity = user.data.id;
      const input = { nombre: 'Temporal',email,telefono: '123',identityUserId: user.data.id };
      const c = await request('/clientes',admin,'POST',input); assert.equal(c.status,201); temporaryClient = c.data.id;
      assert.equal((await request('/clientes/'+c.data.id,admin)).status,200);
      const { identityUserId,...update } = input;
      assert.equal((await request('/clientes/'+c.data.id,admin,'PUT',{ ...update,nombre: 'Actualizado' })).data.nombre,'Actualizado');
    });
    await t.test('vehículo propio, acceso ajeno y cambios de dueño rechazados', async () => {
      const v = await request('/vehiculos',a,'POST',{ matricula: 'TEST-'+randomUUID(),marca: 'Test',modelo: 'Test' }); assert.equal(v.status,201); vehicleId = v.data.id;
      assert.equal(v.data.clienteId,ca.id);
      assert.equal((await request('/vehiculos/'+vehicleId,b)).status,403);
      assert.equal((await request('/vehiculos/'+vehicleId,b,'DELETE')).status,403);
      assert.equal((await request('/vehiculos/'+vehicleId,a,'PUT',{ matricula: v.data.matricula,marca:'Cambio',modelo:'Test',clienteId: cb.id })).status,400);
      assert.equal((await request('/vehiculos/'+vehicleId,a,'PUT',{ matricula:v.data.matricula,marca:'Cambio',modelo:'Test' })).status,200);
      const catalog = await request('/catalogo',b); assert.equal(catalog.status,200); assert.ok(catalog.data.every(v => !('clienteId' in v)));
    });
    const interval = { vehiculoId: '',inicio: '2035-01-01T10:00:00Z',fin:'2035-01-01T11:00:00Z' };
    let reservation;
    await t.test('reserva propia prohibida y solo una alta en 12 solicitudes simultáneas', async () => {
      interval.vehiculoId = vehicleId;
      assert.equal((await request('/reservas',a,'POST',interval)).status,400);
      assert.equal((await request('/reservas',b,'POST',{ ...interval,clienteId: ca.id })).status,403);
      const results = await Promise.all(Array.from({ length: 12 },() => request('/reservas',b,'POST',interval)));
      results.forEach(r => pids.add(r.pid));
      assert.equal(results.filter(r => r.status === 201).length,1);
      assert.equal(results.filter(r => r.status === 409).length,11);
      reservation = results.find(r => r.status === 201).data;
      assert.equal(reservation.clienteId,cb.id);
    });
    await t.test('pertenencia de reserva y RF4 sin clienteId suministrado', async () => {
      assert.equal((await request('/reservas/'+reservation.id,a)).status,403);
      assert.equal((await request('/reservas/'+reservation.id+'/cancelar',a,'POST')).status,403);
      assert.equal((await request('/reservas?clienteId='+ca.id,b)).status,400);
      const own = await request('/reservas',b); assert.ok(own.data.every(r => r.clienteId === cb.id));
      assert.equal((await request('/clientes/'+ca.id,admin,'DELETE')).status,409);
      assert.equal((await request('/vehiculos/'+vehicleId,a,'DELETE')).status,409);
    });
    let adjacent;
    await t.test('intervalos contiguos válidos, modificación conflictiva y filtros', async () => {
      const next = await request('/reservas',b,'POST',{ ...interval,inicio: interval.fin,fin:'2035-01-01T12:00:00Z' }); assert.equal(next.status,201); adjacent = next.data;
      assert.equal((await request('/reservas/'+next.data.id,b,'PUT',{ inicio:'2035-01-01T10:30:00Z',fin:next.data.fin })).status,409);
      assert.equal((await request('/reservas/'+next.data.id,b,'PUT',{ inicio:'2035-01-01T12:00:00Z',fin:'2035-01-01T13:00:00Z' })).status,200);
      const query = new URLSearchParams({ clienteId: cb.id,estado:'ACTIVA',desde:'2035-01-01T10:30:00Z',hasta:'2035-01-01T11:30:00Z' });
      const filtered = await request('/admin/reservas?'+query,admin); assert.equal(filtered.status,200); assert.equal(filtered.data.length,1); assert.equal(filtered.data[0].id,reservation.id);
    });
    await t.test('cancelar libera intervalo y no permite reactivar', async () => {
      const cancel = await request('/reservas/'+reservation.id+'/cancelar',b,'POST'); assert.equal(cancel.data.estado,'CANCELADA');
      assert.equal((await request('/reservas/'+reservation.id,b,'PUT',{ inicio:interval.inicio,fin:interval.fin })).status,409);
      assert.equal((await request('/reservas/'+reservation.id+'/cancelar',b,'POST')).status,200);
      assert.equal((await request('/reservas',b,'POST',interval)).status,201);
    });
    await t.test('auditoría autenticada y deduplicación persistente', async () => {
      const event = { eventId:randomUUID(),tipo:'PRUEBA',entidad:'Reserva',entidadId:reservation.id,userId:randomUUID(),fechaHora:new Date().toISOString() };
      const options = { method:'POST',headers:{ 'Content-Type':'application/json','X-Audit-Secret':process.env.AUDIT_SECRET },body:JSON.stringify(event) };
      assert.equal((await fetch(process.env.AUDIT_URL+'/events',{ ...options,headers:{'Content-Type':'application/json'} })).status,401);
      for (let i=0;i<2;i++) assert.equal((await fetch(process.env.AUDIT_URL+'/events',options)).status,204);
      const { DatabaseSync } = require('node:sqlite'); const audit = new DatabaseSync(process.env.AUDIT_FILE,{ readOnly:true });
      try {
        assert.equal(audit.prepare('SELECT count(*) AS n FROM events WHERE event_id=?').get(event.eventId).n,1);
        const rows = audit.prepare('SELECT payload FROM events').all().map(r => JSON.parse(r.payload));
        assert.ok(rows.some(r => r.entidadId === reservation.id && r.tipo === 'ALTA'));
        assert.equal(rows.filter(r => r.entidadId === reservation.id && r.tipo === 'CANCELACION').length,1);
      } finally { audit.close(); }
    });
    await t.test('CRUD de bajas sin referencias', async () => {
      assert.equal((await request('/clientes/'+temporaryClient,admin,'DELETE')).status,204); temporaryClient = undefined;
      const v = await request('/vehiculos',a,'POST',{ matricula: 'DELETE-'+randomUUID(),marca:'Test',modelo:'Test' });
      assert.equal((await request('/vehiculos/'+v.data.id,a,'DELETE')).status,204);
    });
    console.log('Workers observados durante carrera:',[...pids].join(', '));
    if (process.env.EXPECT_WORKERS) assert.ok(pids.size >= Number(process.env.EXPECT_WORKERS),'La carrera debe cubrir más de un proceso');
  } finally {
    if (vehicleId) { await db.query('DELETE FROM reservas WHERE vehiculo_id=$1',[vehicleId]); await db.query('DELETE FROM vehiculos WHERE id=$1',[vehicleId]); }
    if (temporaryClient) await db.query('DELETE FROM clientes WHERE id=$1',[temporaryClient]);
    await db.end();
    if (temporaryIdentity) { const identity = new Pool({ connectionString:process.env.IDENTITY_DATABASE_URL }); try { await identity.query('DELETE FROM users WHERE id=$1',[temporaryIdentity]); } finally { await identity.end(); } }
  }
});
