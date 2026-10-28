import { randomUUID } from 'node:crypto';
import { Actor, Cliente, Vehiculo, Reserva, Page, ReservaFilter } from '../domain';
import { IdentityRepository } from '../identity/identity';
import { EventPublisher } from '../audit/publisher';
import { AppError } from '../shared/errors';
import { BusinessRepository } from './repository';

export function requireAdmin(actor: Actor) {
  if (actor.role !== 'ADMIN') throw new AppError(403, 'Se requiere rol ADMIN');
}
export function validateInterval(inicio: string, fin: string) {
  if (!(Date.parse(inicio) < Date.parse(fin))) throw new AppError(400, 'inicio debe ser anterior a fin');
}
function found<T>(value: T | undefined): T {
  if (!value) throw new AppError(404, 'Registro inexistente');
  return value;
}
export class BusinessService {
  constructor(private repo: BusinessRepository, private users: IdentityRepository, private events: EventPublisher) {}
  private async mine(actor: Actor, repo = this.repo) {
    const cliente = await repo.clienteByUser(actor.userId);
    if (!cliente) throw new AppError(403, 'El usuario no está vinculado a un cliente');
    return cliente;
  }
  private async owner(actor: Actor, clienteId: string, repo = this.repo) {
    if (actor.role !== 'ADMIN' && (await this.mine(actor, repo)).id !== clienteId) throw new AppError(403, 'El recurso pertenece a otro cliente');
  }
  private async audit(actor: Actor, tipo: string, entidad: string, entidadId: string) {
    await this.events.publish({ eventId: randomUUID(), tipo, entidad, entidadId, userId: actor.userId, fechaHora: new Date().toISOString() });
  }
  me(actor: Actor) { return this.mine(actor); }
  clientes(actor: Actor, page: Page) { requireAdmin(actor); return this.repo.clientes(page); }
  async cliente(actor: Actor, id: string) { requireAdmin(actor); return found(await this.repo.cliente(id)); }
  async createCliente(actor: Actor, input: Omit<Cliente, 'id'>) {
    requireAdmin(actor);
    if (!await this.users.exists(input.identityUserId)) throw new AppError(400, 'La identidad indicada no existe');
    const c = await this.repo.transaction(repo => repo.saveCliente({ ...input, id: randomUUID() }, true));
    await this.audit(actor, 'ALTA', 'Cliente', c.id); return c;
  }
  async updateCliente(actor: Actor, id: string, input: Pick<Cliente, 'nombre' | 'email' | 'telefono'>) {
    requireAdmin(actor);
    const c = await this.repo.transaction(async repo => repo.saveCliente({ ...found(await repo.cliente(id)), ...input }, false));
    await this.audit(actor, 'MODIFICACION', 'Cliente', c.id); return c;
  }
  async deleteCliente(actor: Actor, id: string) {
    requireAdmin(actor);
    await this.repo.transaction(async repo => { found(await repo.cliente(id)); await repo.deleteCliente(id); });
    await this.audit(actor, 'BAJA', 'Cliente', id);
  }
  async vehiculos(actor: Actor, page: Page, catalogo: boolean) {
    if (actor.role === 'ADMIN') return this.repo.vehiculos(page);
    const cliente = await this.mine(actor);
    return this.repo.vehiculos(page, catalogo ? undefined : cliente.id, catalogo ? cliente.id : undefined);
  }
  async vehiculo(actor: Actor, id: string) {
    const v = found(await this.repo.vehiculo(id)); await this.owner(actor, v.clienteId); return v;
  }
  async createVehiculo(actor: Actor, input: Omit<Vehiculo, 'id' | 'clienteId'> & { clienteId?: string }) {
    const clienteId = actor.role === 'ADMIN' ? input.clienteId : (await this.mine(actor)).id;
    if (!clienteId) throw new AppError(400, 'ADMIN debe indicar clienteId');
    if (actor.role !== 'ADMIN' && input.clienteId && input.clienteId !== clienteId) throw new AppError(403, 'No puede asignar un vehículo a otro cliente');
    const v = await this.repo.transaction(async repo => {
      found(await repo.cliente(clienteId));
      return repo.saveVehiculo({ ...input, clienteId, id: randomUUID() }, true);
    });
    await this.audit(actor, 'ALTA', 'Vehiculo', v.id); return v;
  }
  async updateVehiculo(actor: Actor, id: string, input: Pick<Vehiculo, 'matricula' | 'marca' | 'modelo'>) {
    const v = await this.repo.transaction(async repo => {
      const current = found(await repo.vehiculo(id, true)); await this.owner(actor, current.clienteId, repo);
      return repo.saveVehiculo({ ...current, ...input }, false);
    });
    await this.audit(actor, 'MODIFICACION', 'Vehiculo', id); return v;
  }
  async deleteVehiculo(actor: Actor, id: string) {
    await this.repo.transaction(async repo => {
      const v = found(await repo.vehiculo(id, true)); await this.owner(actor, v.clienteId, repo); await repo.deleteVehiculo(id);
    });
    await this.audit(actor, 'BAJA', 'Vehiculo', id);
  }
  async reservas(actor: Actor, filter: ReservaFilter, global = false) {
    if (global) { requireAdmin(actor); return this.repo.reservas(filter); }
    return this.repo.reservas({ ...filter, clienteId: (await this.mine(actor)).id });
  }
  async reserva(actor: Actor, id: string) {
    const r = found(await this.repo.reserva(id)); await this.owner(actor, r.clienteId); return r;
  }
  async createReserva(actor: Actor, input: { clienteId?: string; vehiculoId: string; inicio: string; fin: string }) {
    validateInterval(input.inicio, input.fin);
    const clienteId = actor.role === 'ADMIN' ? input.clienteId : (await this.mine(actor)).id;
    if (!clienteId) throw new AppError(400, 'ADMIN debe indicar clienteId');
    if (actor.role !== 'ADMIN' && input.clienteId && input.clienteId !== clienteId) throw new AppError(403, 'No puede reservar por otro cliente');
    const r = await this.repo.transaction(async repo => {
      found(await repo.cliente(clienteId));
      // El bloqueo también coordina borrado de vehículo y creación de reserva.
      const v = found(await repo.vehiculo(input.vehiculoId, true));
      if (v.clienteId === clienteId) throw new AppError(400, 'No se puede reservar un vehículo propio');
      return repo.saveReserva({ ...input, inicio: new Date(input.inicio).toISOString(), fin: new Date(input.fin).toISOString(), clienteId, id: randomUUID(), estado: 'ACTIVA' }, true);
    });
    await this.audit(actor, 'ALTA', 'Reserva', r.id); return r;
  }
  async updateReserva(actor: Actor, id: string, input: { inicio: string; fin: string }) {
    validateInterval(input.inicio, input.fin);
    const r = await this.repo.transaction(async repo => {
      const current = found(await repo.reserva(id, true)); await this.owner(actor, current.clienteId, repo);
      if (current.estado !== 'ACTIVA') throw new AppError(409, 'Una reserva cancelada no se modifica');
      return repo.saveReserva({ ...current, inicio: new Date(input.inicio).toISOString(), fin: new Date(input.fin).toISOString() }, false);
    });
    await this.audit(actor, 'MODIFICACION', 'Reserva', id); return r;
  }
  async cancelReserva(actor: Actor, id: string) {
    const result = await this.repo.transaction(async repo => {
      const current = found(await repo.reserva(id, true)); await this.owner(actor, current.clienteId, repo);
      if (current.estado === 'CANCELADA') return { reserva: current, changed: false };
      return { reserva: await repo.saveReserva({ ...current, estado: 'CANCELADA' }, false), changed: true };
    });
    if (result.changed) await this.audit(actor, 'CANCELACION', 'Reserva', id);
    return result.reserva;
  }
}
