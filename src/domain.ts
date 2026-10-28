export type Role = 'ADMIN' | 'CLIENTE';
export interface Actor { userId: string; role: Role }
export interface Cliente { id: string; nombre: string; email: string; telefono: string; identityUserId: string }
export interface Vehiculo { id: string; matricula: string; marca: string; modelo: string; clienteId: string }
export interface Reserva { id: string; clienteId: string; vehiculoId: string; inicio: string; fin: string; estado: 'ACTIVA' | 'CANCELADA' }
export interface EventoAuditoria {
  eventId: string; tipo: string; entidad: string; entidadId: string; userId: string; fechaHora: string;
}
export interface Page { limit: number; offset: number }
export interface ReservaFilter extends Page { clienteId?: string; estado?: string; desde?: string; hasta?: string }
