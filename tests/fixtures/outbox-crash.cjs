// Proceso auxiliar de pruebas: permite matar un proceso en ventanas reales, sin hooks en producción.
const { Pool } = require('pg');
const { BusinessService } = require('../../dist/business/service');
const { PgBusinessRepository } = require('../../dist/business/repository');
const { OutboxDispatcher } = require('../../dist/audit/outbox');
const { HttpEventPublisher } = require('../../dist/audit/publisher');
process.on('message',async input => {
  const pool = new Pool({ connectionString:process.env.BUSINESS_DATABASE_URL,max:1 });
  try {
    if (input.mode === 'commit') {
      const service = new BusinessService(new PgBusinessRepository(pool),{});
      const vehicle = await service.createVehiculo(input.actor,{ matricula:input.matricula,marca:'Crash test',modelo:'Demo' });
      process.send({ phase:'committed',entityId:vehicle.id });
      setInterval(() => {},1000);
    } else {
      const http = new HttpEventPublisher(process.env.AUDIT_URL,process.env.AUDIT_SECRET);
      const dispatcher = new OutboxDispatcher(pool,{
        publish:async event => {
          await http.publish(event);
          process.send({ phase:'persisted',eventId:event.eventId });
          // Se mata desde el padre antes de retornar y marcar delivered_at.
          await new Promise(() => {});
        }
      });
      await dispatcher.dispatchOne();
    }
  } catch (error) { process.send({ error:error.message }); process.exitCode=1; await pool.end(); process.disconnect(); }
});
