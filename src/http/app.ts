import express, { ErrorRequestHandler, RequestHandler } from 'express';
import path from 'node:path';
import { z, ZodError } from 'zod';
import { BusinessService } from '../business/service';
import { IdentityService } from '../identity/identity';
import { AppError, databaseError } from '../shared/errors';
import { Actor } from '../domain';

const text = z.string().trim().min(1).max(150);
const cliente = z.object({ nombre: text, email: z.email().max(254).transform(s => s.toLowerCase()), telefono: text }).strict();
const vehicle = z.object({ matricula: text.transform(s => s.toUpperCase()), marca: text, modelo: text }).strict();
const dates = z.object({ inicio: z.iso.datetime({ offset: true }), fin: z.iso.datetime({ offset: true }) }).strict();
const page = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).max(1000000).default(0) });
const filters = page.extend({ clienteId: z.uuid().optional(), estado: z.enum(['ACTIVA','CANCELADA']).optional(), desde: z.iso.datetime({ offset: true }).optional(), hasta: z.iso.datetime({ offset: true }).optional() }).strict();
const login = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) }).strict();
const id = (value: unknown) => z.uuid().parse(value);
const actor = (res: express.Response) => res.locals.actor as Actor;

export function createApp(business: BusinessService, identity: IdentityService) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('X-Worker-Pid', String(process.pid)); next(); });
  app.use(express.json({ limit: '32kb' }));
  // Los tokens se mantienen en memoria del navegador; no se inyecta HTML de datos externos.
  app.use((_req, res, next) => {
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'");
    res.set('X-Content-Type-Options', 'nosniff'); next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/api/auth/login', async (req, res) => { const input = login.parse(req.body); res.json(await identity.login(input.email,input.password)); });
  const authenticated: RequestHandler = (req, res, next) => {
    const header = req.get('Authorization');
    if (!header?.startsWith('Bearer ')) throw new AppError(401, 'Se requiere Bearer token');
    res.locals.actor = identity.validate(header.slice(7)); next();
  };
  app.use('/api', authenticated);
  app.post('/api/auth/users', async (req, res) => {
    const input = login.extend({ password: z.string().min(10).max(128) }).parse(req.body);
    res.status(201).json(await identity.createUser(actor(res), input.email, input.password));
  });
  app.get('/api/auth/me', async (_req, res) => res.json({ ...actor(res), cliente: actor(res).role === 'CLIENTE' ? await business.me(actor(res)) : null }));
  app.get('/api/clientes', async (req, res) => res.json(await business.clientes(actor(res),page.strict().parse(req.query))));
  app.get('/api/clientes/:id', async (req, res) => res.json(await business.cliente(actor(res),id(req.params.id))));
  app.post('/api/clientes', async (req, res) => res.status(201).json(await business.createCliente(actor(res),cliente.extend({ identityUserId: z.uuid() }).parse(req.body))));
  app.put('/api/clientes/:id', async (req, res) => res.json(await business.updateCliente(actor(res),id(req.params.id),cliente.parse(req.body))));
  app.delete('/api/clientes/:id', async (req, res) => { await business.deleteCliente(actor(res),id(req.params.id)); res.sendStatus(204); });
  app.get('/api/vehiculos', async (req, res) => res.json(await business.vehiculos(actor(res),page.strict().parse(req.query),false)));
  app.get('/api/catalogo', async (req, res) => res.json((await business.vehiculos(actor(res),page.strict().parse(req.query),true)).map(({ clienteId: _owner, ...v }) => v)));
  app.get('/api/vehiculos/:id', async (req, res) => res.json(await business.vehiculo(actor(res),id(req.params.id))));
  app.post('/api/vehiculos', async (req, res) => res.status(201).json(await business.createVehiculo(actor(res),vehicle.extend({ clienteId: z.uuid().optional() }).parse(req.body))));
  app.put('/api/vehiculos/:id', async (req, res) => res.json(await business.updateVehiculo(actor(res),id(req.params.id),vehicle.parse(req.body))));
  app.delete('/api/vehiculos/:id', async (req, res) => { await business.deleteVehiculo(actor(res),id(req.params.id)); res.sendStatus(204); });
  app.get('/api/reservas', async (req, res) => {
    const f = filters.omit({ clienteId: true }).parse(req.query); checkFilter(f);
    res.json(await business.reservas(actor(res),f));
  });
  app.get('/api/admin/reservas', async (req, res) => { const f = filters.parse(req.query); checkFilter(f); res.json(await business.reservas(actor(res),f,true)); });
  app.get('/api/reservas/:id', async (req, res) => res.json(await business.reserva(actor(res),id(req.params.id))));
  app.post('/api/reservas', async (req, res) => res.status(201).json(await business.createReserva(actor(res),dates.extend({ vehiculoId: z.uuid(), clienteId: z.uuid().optional() }).parse(req.body))));
  app.put('/api/reservas/:id', async (req, res) => res.json(await business.updateReserva(actor(res),id(req.params.id),dates.parse(req.body))));
  app.post('/api/reservas/:id/cancelar', async (req, res) => res.json(await business.cancelReserva(actor(res),id(req.params.id))));
  app.use(express.static(path.resolve('public')));
  app.use((_req, _res, next) => next(new AppError(404, 'Ruta inexistente')));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) { res.status(400).json({ error: 'Datos inválidos', details: error.issues }); return; }
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') { res.status(400).json({ error: 'JSON inválido o demasiado grande' }); return; }
    let mapped = error;
    try { databaseError(error); } catch (e) { mapped = e; }
    if (mapped instanceof AppError) { res.status(mapped.status).json({ error: mapped.message, details: mapped.details }); return; }
    console.error(error); res.status(500).json({ error: 'Error interno' });
  };
  app.use(errors);
  return app;
}
function checkFilter(f: { desde?: string; hasta?: string }) {
  if (f.desde && f.hasta && Date.parse(f.desde) >= Date.parse(f.hasta)) throw new AppError(400, 'desde debe ser anterior a hasta');
}
