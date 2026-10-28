import { setTimeout as sleep } from 'node:timers/promises';
import { Pool } from 'pg';
import { config } from '../config';
import { OutboxDispatcher } from './outbox';
import { HttpEventPublisher } from './publisher';

async function main() {
  // Pool exclusivo y pequeño: una entrega HTTP puede ocupar una conexión hasta 1,5 segundos.
  const pool = new Pool({ connectionString:config.BUSINESS_DATABASE_URL,max:2,
    connectionTimeoutMillis:3000,statement_timeout:5000 });
  pool.on('error',error => console.error('Outbox PostgreSQL:',error.message));
  const stop = new AbortController();
  process.on('SIGINT',() => stop.abort()); process.on('SIGTERM',() => stop.abort());
  try {
    await pool.query('SELECT event_id FROM integration.outbox LIMIT 0');
    const dispatcher = new OutboxDispatcher(pool,new HttpEventPublisher(config.AUDIT_URL,config.AUDIT_SECRET));
    console.log('Publicador outbox listo');
    if (process.send) process.send('ready');
    while (!stop.signal.aborted) {
      try {
        // Lotes acotados para revisar señales de cierre también al vaciar un backlog grande.
        let processed = 0;
        while (!stop.signal.aborted && processed < 50 && await dispatcher.dispatchOne()) processed++;
        if (processed === 50) continue;
      } catch (error) { console.error('Outbox: se reintentará al recuperar la conexión',error instanceof Error ? error.message : error); }
      try { await sleep(config.OUTBOX_POLL_MS,undefined,{ signal:stop.signal }); }
      catch (error) { if (!stop.signal.aborted) throw error; }
    }
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
