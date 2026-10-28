import { Pool } from 'pg';
import { config } from './config';
export function createPools() {
  const options = { max: config.DB_POOL_MAX, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000, statement_timeout: 5000, lock_timeout: 3000 };
  const business = new Pool({ ...options, connectionString: config.BUSINESS_DATABASE_URL });
  const identity = new Pool({ ...options, connectionString: config.IDENTITY_DATABASE_URL });
  for (const pool of [business, identity]) pool.on('error', error => console.error('Conexión PostgreSQL:', error.message));
  return { business, identity, close: () => Promise.all([business.end(), identity.end()]) };
}
