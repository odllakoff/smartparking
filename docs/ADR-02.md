# ADR-02: entrega durable mediante outbox transaccional

Estado: aceptada e implementada. Fecha: 28/10/2026. Reemplaza ADR-01 en la coordinación entre negocio y auditoría; mantiene su contrato de evento y el transporte HTTP del receptor.

## Problema

La publicación HTTP posterior al commit dejaba una ventana de pérdida: el cambio podía guardarse y el proceso caer antes de notificar al log. Los reintentos en memoria no sobrevivían a esa caída. Se requiere que cada cambio confirmado conserve su evento hasta entregarlo, sin que la disponibilidad temporal del receptor impida operar.

## Alternativas

1. Mantener HTTP posterior al commit: implementación pequeña, pero deja la ventana de pérdida y acopla la respuesta del CRUD a la disponibilidad del log.
2. Publicar directamente en RabbitMQ con mensajes persistentes y confirmación: desacopla el consumidor y conserva mensajes aceptados por el broker, pero sigue existiendo una escritura doble entre PostgreSQL y el broker. Necesita coordinación adicional para cerrar la ventana.
3. Guardar un outbox en la misma transacción PostgreSQL y publicarlo por polling: evita la escritura doble en el camino del CRUD y permite recuperar entregas pendientes después de reiniciar. Agrega una tabla técnica y un proceso publicador.

## Decisión

Adoptar la alternativa 3. La transacción del repositorio proporciona tanto BusinessRepository como EventPublisher, ambos vinculados a la misma conexión PostgreSQL. BusinessService guarda el cambio y publica el evento hacia PgOutboxPublisher dentro de esa transacción. Si cualquiera falla, ambos se revierten. La API responde al confirmar el commit.

El proceso smartparking-outbox, administrado por PM2 en modo fork, consulta integration.outbox. Toma un evento vencido con SELECT FOR UPDATE SKIP LOCKED, lo envía mediante HttpEventPublisher y marca delivered_at solamente después de la confirmación del receptor. Este confirma al persistir en su log SQLite independiente, con eventId único. Si falla la entrega, el publicador conserva el evento y registra attempts, last_error y next_attempt_at; reintenta indefinidamente con espera exponencial de 1 a 60 segundos. El polling predeterminado es de 500 ms y puede configurarse.

Cada intento conserva el eventId original. Si el receptor guarda y el publicador cae antes de marcar delivered_at, el siguiente intento reenvía el evento y el receptor lo deduplica. La garantía es entrega **al menos una vez** con almacenamiento idempotente en el log.

## Interpretación de las tres entidades

Se mantienen exactamente tres entidades del dominio: Cliente, Vehiculo y Reserva, en el esquema public. Se agrega una cuarta tabla física, integration.outbox, como estado técnico de integración, en la misma base para participar del commit local. No es una entidad expuesta por la API ni sustituye el log independiente. La incorporación fue decidida explícitamente por el equipo durante este trabajo. Esta interpretación de la restricción de la consigna queda visible y debe explicarse al presentar el diseño; no se afirma que exista una confirmación adicional del docente sobre tablas técnicas.

## Consecuencias y tácticas

- Confiabilidad: un cambio confirmado conserva su evento aunque el proceso de API termine inmediatamente después del commit. El trabajo pendiente sobrevive al reinicio del publicador.
- Disponibilidad: el CRUD necesita negocio y outbox disponibles; puede responder exitosamente mientras auditoría esté caída. Una respuesta exitosa confirma persistencia del evento pendiente, no entrega inmediata.
- Integrabilidad: se conserva EventoAuditoriaDTO y POST /events. EventPublisher desacopla al publicador de HTTP y permite incorporar un broker más adelante.
- Modificabilidad: las reglas CRUD, las rutas y los repositorios de negocio no requieren cambios para sustituir el transporte del publicador; se cambia su adaptador en audit/worker.ts.
- Performance: las escrituras agregan un INSERT dentro de su transacción y dejan de esperar HTTP. Las consultas siguen sin publicar eventos. El publicador tiene un pool independiente de dos conexiones.
- Simplicidad: se usa un intento HTTP por evento con timeout de 1.500 ms. El lock de fila se mantiene durante ese intento acotado para simplificar recuperación y exclusión; no se implementan leases ni un broker adicional.
- Concurrencia: SKIP LOCKED evita que dos publicadores tomen simultáneamente la misma fila; la demo ejecuta uno. Una caída libera el lock al cerrarse la conexión, sin marcar entrega.
- Seguridad: el receptor permanece en loopback con secreto propio; los eventos no contienen contraseñas ni JWT.

## Límites y operación

La entrega eventual presupone conservar el almacenamiento de PostgreSQL y SQLite, ejecutar el publicador y recuperar la disponibilidad/configuración del receptor. No protege contra pérdida de volúmenes, borrado manual ni errores permanentes que nunca se reparen. No garantiza orden estricto de entrega, porque los reintentos pueden postergar un evento y permitir procesar otros. No implementa exactamente una vez en el transporte.

Las filas entregadas se conservan para inspección en esta versión educativa. Se debe observar el backlog, la antigüedad del pendiente más viejo, attempts y last_error. Un receptor caído produce acumulación durable y el crecimiento requiere capacidad de disco; una política de retención futura podrá eliminar solamente filas entregadas después del plazo acordado. El log de auditoría tiene su propia retención y almacenamiento.

El seed prepara datos de demostración directamente y no genera eventos históricos. La garantía aplica a los cambios de negocio ejecutados por la aplicación después de instalar el esquema outbox. La migración es aditiva e idempotente mediante npm run db:setup; no borra datos ni reconstruye eventos de la versión previa.

## Verificación

tests/outbox.integration.cjs crea una base efímera aislada y comprueba: rollback del negocio al fallar la inserción del evento; rollback conjunto posterior a ambas escrituras; muerte de un proceso después del commit y entrega por otro; alta HTTP con receptor caído, reintento persistido y recuperación tras reiniciar; muerte del publicador después de que el receptor guardó y deduplicación al reenviar; consumidores concurrentes tomando filas diferentes.

Las suites generales verifican permisos, reservas, cancelación idempotente y llegada eventual al log. La carga k6 se vuelve a ejecutar con el publicador activo; el resultado y sus condiciones se registran en RESULTADOS.md.

Referencias: [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox), [Polling publisher](https://microservices.io/patterns/data/polling-publisher.html), [PostgreSQL: SELECT y SKIP LOCKED](https://www.postgresql.org/docs/17/sql-select.html).
