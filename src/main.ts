import { createPools } from './db';
import { config } from './config';
import { PgIdentityRepository, IdentityService } from './identity/identity';
import { PgBusinessRepository } from './business/repository';
import { BusinessService } from './business/service';
import { createApp } from './http/app';

async function main() {
  const pools = createPools();
  try {
    await Promise.all([pools.business.query('SELECT event_id FROM integration.outbox LIMIT 0'),pools.identity.query('SELECT 1')]);
    // La única composición de adaptadores está aquí: los casos de uso no conocen HTTP ni pg.
    const users = new PgIdentityRepository(pools.identity);
    const identity = new IdentityService(users,config.JWT_SECRET);
    const business = new BusinessService(new PgBusinessRepository(pools.business),users);
    const server = createApp(business,identity).listen(config.PORT, () => {
      console.log(`SmartParking http://localhost:${config.PORT} (pid ${process.pid})`);
      if (process.send) process.send('ready');
    });
    const stop = () => {
      const deadline = setTimeout(() => process.exit(1),9000); deadline.unref();
      server.close(() => { void pools.close().then(() => process.exit(0)); });
    };
    process.on('SIGINT',stop); process.on('SIGTERM',stop);
  } catch (error) { await pools.close(); throw error; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
