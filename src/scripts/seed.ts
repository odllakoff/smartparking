import { randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { createPools } from '../db';
import { hashPassword } from '../identity/identity';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('El seed de demostración no se ejecuta en producción');
  const pools = createPools();
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 10) throw new Error('DEMO_PASSWORD debe tener al menos 10 caracteres');
  try {
    const hash = await hashPassword(password);
    const clients: string[] = [];
    for (let i = 0; i < 21; i++) {
      const email = i === 0 ? 'admin@demo.local' : `cliente${i}@demo.local`;
      const user = (await pools.identity.query(`INSERT INTO users VALUES ($1,$2,$3,$4)
        ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id`, [randomUUID(),email,hash,i === 0 ? 'ADMIN' : 'CLIENTE'])).rows[0];
      if (i > 0) {
        const client = (await pools.business.query(`INSERT INTO clientes VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id`, [randomUUID(),`Cliente ${i}`,email,'099123456',user.id])).rows[0];
        clients.push(client.id);
      }
    }
    const vehicles: string[] = [];
    for (let i = 0; i < clients.length; i++) {
      for (let j = 0; j < 5; j++) {
        const v = (await pools.business.query(`INSERT INTO vehiculos VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT(matricula) DO UPDATE SET matricula=EXCLUDED.matricula RETURNING id`, [randomUUID(),`DEMO-${i}-${j}`,'Marca demo',`Modelo ${j}`,clients[i]])).rows[0];
        vehicles.push(v.id);
      }
    }
    // IDs deterministas para repetir el seed sin duplicar las reservas de demostración.
    await pools.business.query(`INSERT INTO reservas (id,cliente_id,vehiculo_id,inicio,fin,estado)
      SELECT md5('smartparking-demo-' || g::text)::uuid,
      ($1::uuid[])[((g / 100) / 5 + 1) % 20 + 1], ($2::uuid[])[g / 100 + 1],
      '2030-01-01'::timestamptz + (g % 100) * interval '2 hours',
      '2030-01-01'::timestamptz + (g % 100) * interval '2 hours' + interval '1 hour',
      CASE WHEN g % 5=0 THEN 'CANCELADA' ELSE 'ACTIVA' END
      FROM generate_series(0,9999) g ON CONFLICT(id) DO NOTHING`, [clients,vehicles]);
    await mkdir('data',{ recursive: true });
    await writeFile('data/demo.json',JSON.stringify({ cliente1: clients[0], cliente2: clients[1], vehiculo1: vehicles[0], vehiculoAjeno: vehicles[5], counts: { clientes: 20, vehiculos: 100, reservas: 10000 } },null,2));
    console.log('Demo: admin@demo.local, cliente1@demo.local … cliente20@demo.local. Contraseña: DEMO_PASSWORD de .env.');
  } finally { await pools.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
