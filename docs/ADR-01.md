# ADR-01: comunicación con el registro de eventos

Estado: reemplazada por [ADR-02](ADR-02.md). Fecha original: 28/10/2026.

Este documento conserva la decisión inicial y sus límites como antecedente. El diseño vigente utiliza outbox transaccional para coordinar negocio y eventos; el transporte HTTP se ejecuta desde un publicador independiente. Las menciones posteriores a la ventana no resuelta y a businessApplied describen la versión anterior.

## Contexto

Las altas, modificaciones, bajas y cancelaciones exitosas deben notificar al componente de log independiente. Debe poder cambiarse el mecanismo de comunicación sin cambiar las reglas CRUD. PM2 ejecuta varios workers y la base operacional admite solamente tres entidades persistentes. El objetivo de 500 consultas/s y p95 < 300 ms corresponde a lecturas, no al transporte de auditoría.

## Alternativas

1. HTTP síncrono después del commit hacia un receptor independiente: sin broker, confirmación al persistir, deduplicación por eventId y reintentos acotados. Añade latencia y dependencia de disponibilidad a las escrituras. No ocupa una conexión PostgreSQL durante el envío.
2. RabbitMQ: publicación persistente en cola durable, publisher confirms, consumidor con acknowledgements y almacenamiento idempotente. Permite desacoplar disponibilidad temporal del consumidor y absorber picos. Requiere desplegar y observar un broker, gestionar reconexiones, duplicados, reintentos y mensajes no procesables. No existe garantía de entrega exactamente una vez; se necesita deduplicación.
3. Outbox transaccional más consumidor: guardar cambio y evento pendiente en la misma transacción, y publicar con reintentos. Resuelve la ventana entre commit y publicación. Agrega una tabla operativa de integración y un publicador periódico; su compatibilidad con la restricción de tres entidades debe aclararse antes de adoptarlo.

## Decisión

Implementar inicialmente la alternativa HTTP mediante EventPublisher e HttpEventPublisher. El componente de registro usa SQLite como log independiente, eventId como clave única y un solo escritor. Esto permite una demostración educativa concreta de interfaces, separación de persistencias y comunicación entre procesos. La cola no se descarta: se incorporará si una necesidad de desacoplamiento de escrituras, acumulación de eventos o mediciones de carga lo justifica.

El cambio de transporte consiste en implementar EventPublisher y sustituir el adaptador en main.ts. No se modificarán rutas, autorización, repositorios ni reglas CRUD. La deduplicación es responsabilidad del receptor.

## Consecuencias y fallos

- Modificabilidad: los servicios desconocen HTTP, SQLite y el futuro broker.
- Integrabilidad: EventoAuditoriaDTO fija campos, tipos y semántica; POST /events responde 204 después de persistir, 400 ante contrato inválido y 401 ante secreto incorrecto.
- Performance: las consultas no publican eventos; las escrituras esperan confirmación. Hay hasta tres intentos con timeout de 1.500 ms cada uno.
- Seguridad: transporte interno en loopback y secreto propio. Un despliegue entre máquinas necesitaría TLS y credenciales de servicio apropiadas.
- Disponibilidad y consistencia: negocio y auditoría no son una transacción distribuida. Si el receptor falla después de guardar, el mismo eventId evita duplicación al reintentar. Si todos los intentos fallan, negocio permanece aplicado y la respuesta 503 lo indica explícitamente; stderr conserva el evento mientras el proceso sigue vivo.
- Ventana no resuelta: una caída abrupta tras el commit y antes de emitir el evento puede perder la notificación. No se declara entrega garantizada, ni se afirma que RabbitMQ por sí solo lo resolvería. Para una exigencia de cero pérdidas es necesario acordar una solución durable como outbox/CDC.

## Evidencia y revisión

La integración comprobó evento de alta y una sola cancelación, autenticación del receptor y deduplicación persistente. La prueba de transporte simula tres respuestas 503, conserva eventId y comprueba businessApplied. Falta una prueba de caída de proceso en la ventana commit/publicación; se reconoce como limitación, no como propiedad cubierta.

La carga de consultas final aprobó 500 solicitudes/s durante 60 s, p95 de 242,75 ms, sin errores ni iteraciones descartadas, con dos workers PM2. Como las consultas no publican eventos, esta medición no evalúa capacidad ni disponibilidad de auditoría y no justifica por sí sola adoptar o descartar una cola para escrituras.

Revisar la decisión si se exige tolerancia a caídas sin pérdida, si auditoría pasa a otro equipo/servidor o si la carga de escrituras muestra necesidad de buffering. No introducir una cola solo por existir PM2.
