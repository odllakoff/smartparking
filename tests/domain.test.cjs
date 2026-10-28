const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { hashPassword, verifyPassword, IdentityService } = require('../dist/identity/identity');
const { validateInterval } = require('../dist/business/service');
const { HttpEventPublisher } = require('../dist/audit/publisher');
const { createServer } = require('node:http');
const secret = 'unit-test-only-secret-with-at-least-32-characters';

test('scrypt: salts distintos, contraseña correcta e incorrecta', async () => {
  const a = await hashPassword('Una contraseña larga'), b = await hashPassword('Una contraseña larga');
  assert.notEqual(a,b);
  assert.equal(await verifyPassword('Una contraseña larga',a),true);
  assert.equal(await verifyPassword('Otra contraseña',a),false);
});
test('JWT: login, firma, expiración y audiencia', async () => {
  const user = { id: randomUUID(), role: 'CLIENTE', passwordHash: await hashPassword('Password-123') };
  const service = new IdentityService({ findByEmail: async email => email === 'a@test.local' ? user : undefined },secret);
  const auth = await service.login('a@test.local','Password-123');
  assert.deepEqual(service.validate(auth.accessToken),{ userId: user.id, role: 'CLIENTE' });
  await assert.rejects(service.login('a@test.local','incorrecta'),{ status: 401 });
  await assert.rejects(service.login('nadie@test.local','incorrecta'),{ status: 401 });
  for (const options of [{ secret: 'otra-clave' },{ expiresIn: -1 },{ audience: 'otra-api' }]) {
    const token = jwt.sign({ role: 'CLIENTE' },options.secret || secret,{ subject: user.id, algorithm: 'HS256', expiresIn: options.expiresIn ?? 3600, issuer: 'smartparking', audience: options.audience || 'smartparking-api' });
    assert.throws(() => service.validate(token),{ status: 401 });
  }
});
test('intervalos: rechaza iguales, invertidos e inválidos', () => {
  for (const [a,b] of [['2030-01-01','2030-01-01'],['2030-01-02','2030-01-01'],['x','y']]) assert.throws(() => validateInterval(a,b),{ status: 400 });
  validateInterval('2030-01-01T09:00:00Z','2030-01-01T10:00:00Z');
});
test('auditoría: reintenta con el mismo eventId y explicita commit ante fallo', async () => {
  const received = [];
  const server = createServer(async (req,res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body)); res.writeHead(503); res.end();
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const event = { eventId: randomUUID(), entidadId: randomUUID(), tipo: 'ALTA' };
    const publisher = new HttpEventPublisher(`http://127.0.0.1:${server.address().port}`,'test');
    await assert.rejects(publisher.publish(event),error => error.status === 503 && error.details.businessApplied === true);
    assert.equal(received.length,3); assert.equal(new Set(received.map(e => e.eventId)).size,1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
