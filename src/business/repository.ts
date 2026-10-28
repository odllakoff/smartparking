import { Pool, PoolClient } from 'pg';
import { Cliente, Vehiculo, Reserva, Page, ReservaFilter } from '../domain';
import { databaseError } from '../shared/errors';
import { EventPublisher } from '../audit/publisher';
import { PgOutboxPublisher } from '../audit/outbox';

export interface BusinessRepository {
  transaction<T>(work: (repo: BusinessRepository, events: EventPublisher) => Promise<T>): Promise<T>;
  cliente(id: string): Promise<Cliente | undefined>;
  clienteByUser(userId: string): Promise<Cliente | undefined>;
  clientes(page: Page): Promise<Cliente[]>;
  saveCliente(data: Cliente, create: boolean): Promise<Cliente>;
  deleteCliente(id: string): Promise<void>;
  vehiculo(id: string, lock?: boolean): Promise<Vehiculo | undefined>;
  vehiculos(page: Page, clienteId?: string, excluirCliente?: string): Promise<Vehiculo[]>;
  saveVehiculo(data: Vehiculo, create: boolean): Promise<Vehiculo>;
  deleteVehiculo(id: string): Promise<void>;
  reserva(id: string, lock?: boolean): Promise<Reserva | undefined>;
  reservas(filter: ReservaFilter): Promise<Reserva[]>;
  saveReserva(data: Reserva, create: boolean): Promise<Reserva>;
}
const clienteCols = 'id,nombre,email,telefono,identity_user_id AS "identityUserId"';
const vehiculoCols = 'id,matricula,marca,modelo,cliente_id AS "clienteId"';
const reservaCols = 'id,cliente_id AS "clienteId",vehiculo_id AS "vehiculoId",inicio,fin,estado';
function toReserva(row: any): Reserva | undefined {
  return row && { ...row, inicio: row.inicio.toISOString(), fin: row.fin.toISOString() };
}

export class PgBusinessRepository implements BusinessRepository {
  constructor(private pool: Pool, private connection?: PoolClient) {}
  private get db() { return this.connection ?? this.pool; }
  async transaction<T>(work: (repo: BusinessRepository, events: EventPublisher) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Ambos adaptadores usan LA MISMA conexión: el commit incluye cambio y evento pendiente.
      const result = await work(new PgBusinessRepository(this.pool, client), new PgOutboxPublisher(client));
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); return databaseError(error); }
    finally { client.release(); }
  }
  async cliente(id: string) {
    return (await this.db.query(`SELECT ${clienteCols} FROM clientes WHERE id=$1 ${this.connection ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  }
  async clienteByUser(userId: string) {
    return (await this.db.query(`SELECT ${clienteCols} FROM clientes WHERE identity_user_id=$1`, [userId])).rows[0];
  }
  async clientes(page: Page) {
    return (await this.db.query(`SELECT ${clienteCols} FROM clientes ORDER BY id LIMIT $1 OFFSET $2`, [page.limit, page.offset])).rows;
  }
  async saveCliente(c: Cliente, create: boolean) {
    if (create) await this.db.query('INSERT INTO clientes VALUES ($1,$2,$3,$4,$5)', [c.id,c.nombre,c.email,c.telefono,c.identityUserId]);
    else await this.db.query('UPDATE clientes SET nombre=$2,email=$3,telefono=$4 WHERE id=$1', [c.id,c.nombre,c.email,c.telefono]);
    return c;
  }
  async deleteCliente(id: string) { await this.db.query('DELETE FROM clientes WHERE id=$1', [id]); }
  async vehiculo(id: string, lock = false) {
    return (await this.db.query(`SELECT ${vehiculoCols} FROM vehiculos WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  }
  async vehiculos(page: Page, clienteId?: string, excluirCliente?: string) {
    return (await this.db.query(`SELECT ${vehiculoCols} FROM vehiculos
      WHERE ($3::uuid IS NULL OR cliente_id=$3) AND ($4::uuid IS NULL OR cliente_id<>$4)
      ORDER BY id LIMIT $1 OFFSET $2`, [page.limit,page.offset,clienteId ?? null,excluirCliente ?? null])).rows;
  }
  async saveVehiculo(v: Vehiculo, create: boolean) {
    if (create) await this.db.query('INSERT INTO vehiculos VALUES ($1,$2,$3,$4,$5)', [v.id,v.matricula,v.marca,v.modelo,v.clienteId]);
    // Cambiar el propietario no forma parte del CRUD: alteraría la validez de reservas existentes.
    else await this.db.query('UPDATE vehiculos SET matricula=$2,marca=$3,modelo=$4 WHERE id=$1', [v.id,v.matricula,v.marca,v.modelo]);
    return v;
  }
  async deleteVehiculo(id: string) { await this.db.query('DELETE FROM vehiculos WHERE id=$1', [id]); }
  async reserva(id: string, lock = false) {
    return toReserva((await this.db.query(`SELECT ${reservaCols} FROM reservas WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0]);
  }
  async reservas(f: ReservaFilter) {
    // Los nombres de columna son constantes; todos los valores del usuario son parámetros.
    const values: unknown[] = [];
    const conditions: string[] = [];
    const add = (expression: string, value: unknown) => { values.push(value); conditions.push(expression.replace('?', `$${values.length}`)); };
    if (f.clienteId) add('cliente_id=?', f.clienteId);
    if (f.estado) add('estado=?', f.estado);
    if (f.desde) add('fin>?', f.desde);
    if (f.hasta) add('inicio<?', f.hasta);
    values.push(f.limit, f.offset);
    const rows = (await this.db.query(`SELECT ${reservaCols} FROM reservas
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY inicio,id LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
    return rows.map(row => toReserva(row)!);
  }
  async saveReserva(r: Reserva, create: boolean) {
    if (create) await this.db.query('INSERT INTO reservas VALUES ($1,$2,$3,$4,$5,$6)', [r.id,r.clienteId,r.vehiculoId,r.inicio,r.fin,r.estado]);
    else await this.db.query('UPDATE reservas SET inicio=$2,fin=$3,estado=$4 WHERE id=$1', [r.id,r.inicio,r.fin,r.estado]);
    return r;
  }
}
