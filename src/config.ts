import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BUSINESS_DATABASE_URL: z.url(),
  IDENTITY_DATABASE_URL: z.url(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  JWT_SECRET: z.string().min(32),
  AUDIT_SECRET: z.string().min(32),
  AUDIT_URL: z.url().default('http://127.0.0.1:3001'),
  AUDIT_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  AUDIT_FILE: z.string().default('data/audit.sqlite')
});
export const config = schema.parse(process.env);
if (new URL(config.BUSINESS_DATABASE_URL).pathname === new URL(config.IDENTITY_DATABASE_URL).pathname &&
    new URL(config.BUSINESS_DATABASE_URL).host === new URL(config.IDENTITY_DATABASE_URL).host) {
  throw new Error('Identidad y negocio deben usar bases diferentes');
}
