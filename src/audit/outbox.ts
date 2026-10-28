import { Pool, PoolClient } from 'pg';
import { EventoAuditoria } from '../domain';
import { EventPublisher } from './publisher';

export class PgOutboxPublisher implements EventPublisher {
  // Esta conexión debe ser la transacción del cambio de negocio, nunca un pool independiente.
  constructor(private transaction: PoolClient) {}
  async publish(event: EventoAuditoria) {
    await this.transaction.query('INSERT INTO integration.outbox(event_id,payload) VALUES ($1,$2)',
      [event.eventId,JSON.stringify(event)]);
  }
}

export function retryDelay(attempts: number): number {
  return Math.min(60_000,1000 * 2 ** Math.min(attempts,6));
}

export class OutboxDispatcher {
  constructor(private pool: Pool, private transport: EventPublisher) {}
  async dispatchOne(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // El lock se libera también si el proceso muere. SKIP LOCKED admite consumidores concurrentes.
      const row = (await client.query(`SELECT event_id,payload,attempts FROM integration.outbox
        WHERE delivered_at IS NULL AND next_attempt_at<=now()
        ORDER BY next_attempt_at,created_at,event_id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
      if (!row) { await client.query('COMMIT'); return false; }

      let failure: string | undefined;
      try { await this.transport.publish(row.payload as EventoAuditoria); }
      catch (error) { failure = error instanceof Error ? error.message.slice(0,500) : 'Fallo de entrega'; }

      if (failure !== undefined) {
        await client.query(`UPDATE integration.outbox SET attempts=attempts+1,last_error=$2,
          next_attempt_at=clock_timestamp()+$3::integer*interval '1 millisecond' WHERE event_id=$1`,
          [row.event_id,failure,retryDelay(row.attempts)]);
      } else {
        await client.query(`UPDATE integration.outbox SET attempts=attempts+1,delivered_at=clock_timestamp(),last_error=NULL
          WHERE event_id=$1`,[row.event_id]);
      }
      await client.query('COMMIT');
      if (failure !== undefined) console.warn('OUTBOX_RETRY',row.event_id,failure);
      return true;
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    } finally { client.release(); }
  }
}
