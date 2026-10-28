import { EventoAuditoria } from '../domain';

export interface EventPublisher { publish(event: EventoAuditoria): Promise<void> }
export class HttpEventPublisher implements EventPublisher {
  constructor(private url: string, private secret: string) {}
  async publish(event: EventoAuditoria) {
    // Un intento por invocación. El publicador outbox persiste y programa los reintentos.
    const response = await fetch(`${this.url}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Audit-Secret': this.secret },
      body: JSON.stringify(event), signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Auditoría respondió HTTP ${response.status}`);
    }
  }
}
