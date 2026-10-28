import { EventoAuditoria } from '../domain';
import { AppError } from '../shared/errors';

export interface EventPublisher { publish(event: EventoAuditoria): Promise<void> }
export class HttpEventPublisher implements EventPublisher {
  constructor(private url: string, private secret: string) {}
  async publish(event: EventoAuditoria) {
    // eventId se conserva entre intentos: el receptor puede deduplicar una respuesta perdida.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`${this.url}/events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Audit-Secret': this.secret },
          body: JSON.stringify(event), signal: AbortSignal.timeout(1500)
        });
        if (response.ok) return;
      } catch { /* Reintento acotado ante fallos transitorios del componente independiente. */ }
    }
    // No afirmar que la operación se deshizo: el commit de negocio ya ocurrió.
    console.error('AUDIT_DELIVERY_FAILED', JSON.stringify(event));
    throw new AppError(503, 'Operación aplicada, pero no se confirmó la auditoría. No repita el alta.', {
      businessApplied: true, entidadId: event.entidadId, eventId: event.eventId
    });
  }
}
