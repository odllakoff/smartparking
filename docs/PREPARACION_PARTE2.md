# Revisión preventiva para la segunda parte

Fecha: 28/10/2026. Alcance: inspección del código ante la posibilidad de Pub/Sub, CQRS, manejo de eventos y MongoDB. La consigna de la segunda parte todavía no está disponible.

## Conclusión

No se identificó un bloqueo que justifique una modificación preventiva del código actual. Se mantienen los componentes, contratos y garantías de la primera parte. No se agregaron dependencias, colas, servicios, colecciones, interfaces nuevas ni campos de evento especulativos.

Hay puntos de extensión útiles y límites concretos. Estar preparado para extenderlos no significa que Pub/Sub, CQRS, MongoDB o event sourcing ya estén implementados.

## Pub/Sub

- Punto de extensión: EventPublisher en src/audit/publisher.ts. OutboxDispatcher recibe el transporte por constructor; audit/worker.ts compone hoy HttpEventPublisher.
- Un adaptador que publique en un broker puede reemplazar ese transporte y conservar el guardado transaccional del outbox. La confirmación debe significar aceptación durable del broker antes de marcar delivered_at, con tratamiento explícito de publicación no enrutable según el broker elegido.
- SKIP LOCKED distribuye pendientes entre publicadores; no hace que cada suscriptor reciba cada evento. La difusión a consumidores independientes corresponderá al broker y sus suscripciones/colas.
- El acuse del broker no equivale a que todos los consumidores terminaron. Cada consumidor necesitará su propia confirmación, recuperación e idempotencia. La deduplicación SQLite actual protege solamente el consumidor de auditoría.
- Decisión para hoy: conservar el contrato y esperar qué transporte, suscriptores y garantías pide el ejercicio. No implementar un bus genérico ni un fanout HTTP.

## CQRS

- Las consultas y las escrituras ya son métodos identificables de BusinessService y BusinessRepository. Las rutas HTTP no contienen SQL y no se ejecutan escrituras desde las consultas.
- Ambos grupos comparten actualmente un servicio, una interfaz y una base. Es un CRUD modular, no CQRS ya separado.
- Si se pide un modelo de lectura independiente, extraer un contrato de consultas acotado e inyectar su adaptador será un cambio localizado. Las validaciones de comandos y las transacciones deben seguir consultando la fuente autoritativa.
- Con proyecciones asíncronas habrá que definir consistencia eventual, visibilidad después de escribir y reconstrucción inicial. Los controles de rol y pertenencia no deben depender de una proyección potencialmente atrasada sin una política explícita.
- Decisión para hoy: no crear command/query buses, handlers ni repositorios de lectura sin conocer las consultas y DTOs requeridos.

## Eventos y proyecciones: límite más importante

EventoAuditoria en src/domain.ts contiene eventId, tipo, entidad, entidadId, userId y fechaHora. Es suficiente para registrar quién hizo qué, pero no contiene el estado de la entidad ni los cambios aplicados. Por ejemplo, una MODIFICACION de Reserva no lleva las nuevas fechas.

Por tanto, el contrato actual no permite construir por sí solo una proyección completa de MongoDB ni reconstruir todo el negocio desde el historial. Consultar el estado actual de PostgreSQL al recibir una notificación es una alternativa posible de sincronización, pero no recupera necesariamente el estado histórico de cada cambio; su conveniencia dependerá de la consigna.

Si se solicitan proyecciones basadas en eventos, habrá que definir eventos de integración o de dominio con los datos necesarios, compatibilidad/versionado, tratamiento de bajas, duplicados y eventos fuera de orden. El orden por fechaHora o UUID no sustituye una versión por entidad cuando esta sea necesaria.

La API de auditoría valida un contrato estricto con Zod. Un futuro contrato más rico requerirá una adaptación o una versión explícita, conservando la compatibilidad del consumidor actual; no conviene debilitar la validación anticipadamente.

El outbox sí conserva atómicamente los eventos y permite reenvíos. Sin embargo, no garantiza orden estricto y no constituye un event store con historia completa: el seed no genera eventos históricos y los mensajes actuales no permiten reconstruir el estado. CQRS y event sourcing son decisiones distintas.

Decisión para hoy: documentar el límite. No agregar snapshots, secuencias, payloads, versiones ni nuevas clases de eventos antes de saber qué se deberá proyectar y qué compatibilidad se exigirá.

## MongoDB

- Como modelo de lectura CQRS: puede incorporarse mediante un adaptador de consultas y un consumidor/proyector, conservando PostgreSQL para comandos y outbox. No hay SQL en las rutas ni una dependencia directa de pg en las reglas de negocio que obligue a reemplazarlas.
- Como almacenamiento de auditoría: el receptor actual concentra su persistencia SQLite en src/audit/main.ts. Extraer un adaptador al realizar el cambio sería pequeño; crear una jerarquía de almacenamiento hoy no resuelve un requisito existente.
- Como reemplazo de la fuente de escritura: no sería un cambio de driver. La restricción EXCLUDE que evita reservas solapadas, los locks y la transacción conjunta de negocio/outbox dependen del adaptador PostgreSQL. Habría que rediseñar y probar esas garantías en MongoDB, incluida la sesión/transacción compartida y la topología que la soporte, o usar atomicidad de un solo documento si el nuevo modelo lo permite.
- Decisión para hoy: no migrar persistencia ni agregar infraestructura. Primero determinar el papel de MongoDB en la siguiente consigna.

## Evidencia revisada

- src/business/service.ts: autorización, consultas separables y escrituras mediante change/transaction.
- src/business/repository.ts: contrato de negocio y adaptador relacional; la implementación PostgreSQL comparte conexión con el escritor outbox.
- src/domain.ts y src/audit/main.ts: alcance y validación estricta del evento de auditoría.
- src/audit/outbox.ts y src/audit/worker.ts: entrega durable, dependencia inyectada del transporte y composición sustituible.
- sql/business.sql: integridad temporal de reservas y tabla técnica de integración.
- tests/outbox.integration.cjs: recuperación tras caídas, reenvío idempotente y consumidores concurrentes. Esas pruebas protegen la garantía actual; no prueban un broker ni MongoDB inexistentes.

## Qué decidir cuando llegue la consigna

1. ¿Pub/Sub requiere difusión a varios consumidores, qué broker se usará y qué debe significar su acuse?
2. ¿CQRS exige separar solamente modelos/código o también almacenamiento? ¿Qué consultas debe responder la proyección?
3. ¿Los mensajes son notificaciones o deben transportar información suficiente para actualizar/reconstruir una proyección?
4. ¿Se exige orden por entidad, replay, tolerancia a duplicados o compatibilidad con eventos anteriores?
5. ¿MongoDB será modelo de lectura, log o base autoritativa? ¿Cómo se preservan autorización y ausencia de solapamientos?

Estas son decisiones para la segunda parte, no bloqueos que se deban resolver hoy por anticipado. La primera parte conserva su alcance y su PDF.

## Referencias

- [RabbitMQ: Publish/Subscribe](https://www.rabbitmq.com/tutorials/tutorial-three-javascript): diferencia entre reparto de trabajo y difusión; el ejemplo introductorio no establece por sí solo una configuración durable.
- [Microsoft: patrón CQRS](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs): modelos de lectura/escritura y consistencia eventual.
- [MongoDB: transacciones](https://www.mongodb.com/docs/manual/core/transactions/): atomicidad de documento y transacciones multidocumento con sesiones y configuración apropiada.
