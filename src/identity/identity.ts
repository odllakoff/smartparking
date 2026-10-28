import { createSecretKey, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { Actor, Role } from '../domain';
import { AppError } from '../shared/errors';

const derive = promisify(scrypt);
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, encoded] = hash.split(':');
  if (!salt || !encoded) return false;
  const key = await derive(password, salt, 64) as Buffer;
  const expected = Buffer.from(encoded, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}
export interface IdentityRepository {
  findByEmail(email: string): Promise<{ id: string; passwordHash: string; role: Role } | undefined>;
  exists(id: string): Promise<boolean>;
  create(id: string, email: string, passwordHash: string): Promise<void>;
}
export class PgIdentityRepository implements IdentityRepository {
  constructor(private db: Pool) {}
  async findByEmail(email: string) {
    return (await this.db.query('SELECT id, password_hash AS "passwordHash", role FROM users WHERE email=$1', [email])).rows[0];
  }
  async exists(id: string) {
    return (await this.db.query('SELECT 1 FROM users WHERE id=$1', [id])).rowCount === 1;
  }
  async create(id: string, email: string, passwordHash: string) {
    await this.db.query("INSERT INTO users VALUES ($1,$2,$3,'CLIENTE')", [id,email,passwordHash]);
  }
}
export class IdentityService {
  // Se reutiliza un hash válido para que un email inexistente también ejecute scrypt.
  private dummyHash = hashPassword(randomBytes(32).toString('hex'));
  private key;
  constructor(private users: IdentityRepository, secret: string) {
    // Reutilizar la clave evita que jsonwebtoken intente interpretar un PEM en cada consulta.
    this.key = createSecretKey(Buffer.from(secret));
  }
  async createUser(actor: Actor, email: string, password: string) {
    if (actor.role !== 'ADMIN') throw new AppError(403, 'Se requiere rol ADMIN');
    const id = randomUUID();
    await this.users.create(id,email.toLowerCase(),await hashPassword(password));
    return { id, email: email.toLowerCase(), role: 'CLIENTE' };
  }
  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email.toLowerCase());
    const valid = await verifyPassword(password, user?.passwordHash ?? await this.dummyHash);
    if (!user || !valid) throw new AppError(401, 'Credenciales inválidas');
    return {
      accessToken: jwt.sign({ role: user.role }, this.key, {
        subject: user.id, expiresIn: '1h', algorithm: 'HS256', issuer: 'smartparking', audience: 'smartparking-api'
      }), expiresIn: 3600
    };
  }
  validate(token: string): Actor {
    try {
      const payload = jwt.verify(token, this.key, {
        algorithms: ['HS256'], issuer: 'smartparking', audience: 'smartparking-api'
      });
      if (typeof payload === 'string' || !payload.sub || !['ADMIN', 'CLIENTE'].includes(payload.role)) throw new Error();
      return { userId: payload.sub, role: payload.role };
    } catch { throw new AppError(401, 'Token inválido o vencido'); }
  }
}
