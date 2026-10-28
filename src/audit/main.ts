import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config';

mkdirSync(dirname(config.AUDIT_FILE), { recursive: true });
const db = new DatabaseSync(config.AUDIT_FILE);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
  CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
const insert = db.prepare('INSERT OR IGNORE INTO events VALUES (?, ?)');
const schema = z.object({ eventId: z.uuid(), tipo: z.string().min(1), entidad: z.string().min(1),
  entidadId: z.uuid(), userId: z.uuid(), fechaHora: z.iso.datetime({ offset: true }) }).strict();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/events', (req, res) => {
  const received = Buffer.from(req.get('X-Audit-Secret') ?? '');
  const expected = Buffer.from(config.AUDIT_SECRET);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    res.status(401).json({ error: 'Credenciales de auditoría inválidas' }); return;
  }
  const event = schema.safeParse(req.body);
  if (!event.success) { res.status(400).json({ error: 'Evento inválido' }); return; }
  insert.run(event.data.eventId, JSON.stringify(event.data));
  res.sendStatus(204);
});
// Un solo proceso escribe el log; el publicador outbox envía y reenvía eventos por este contrato.
const server = app.listen(config.AUDIT_PORT, '127.0.0.1', () => console.log(`Auditoría en ${config.AUDIT_PORT}`));
function stop() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
