import { readFile } from 'node:fs/promises';
import { createPools } from '../db';
async function main() {
  const pools = createPools();
  try {
    await pools.business.query(await readFile('sql/business.sql', 'utf8'));
    await pools.identity.query(await readFile('sql/identity.sql', 'utf8'));
    console.log('Esquemas de negocio e identidad preparados');
  } finally { await pools.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
