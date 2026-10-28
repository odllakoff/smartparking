# Diseño e implementación de SmartParking

## A1. Componentes y contratos

La fuente UML editable está en componentes.puml. La partición principal es un monolito modular de negocio con identidad propia y procesos independientes de publicación y registro. PM2 replica la API; no convierte cada módulo en microservicio. PostgreSQL de identidad y PostgreSQL de negocio son servidores y volúmenes diferentes. SQLite del log es un tercer almacenamiento independiente. El outbox se almacena en el servidor de negocio para participar de su transacción.

| Componente | Provee | Requiere | Responsabilidad |
|---|---|---|---|
| UI | Formularios y listados | API REST | Interacción mínima; sin decisiones de autorización |
| API HTTP | REST de negocio y login | BusinessService, IdentityService | Validación Zod, Bearer y autorización ADMIN para consulta global |
| Identidad | login, validate; alta CLIENTE por ADMIN | IdentityRepository | Credenciales propias, hash scrypt, emisión/validación JWT |
| Negocio | CRUD y consultas | BusinessRepository, IdentityRepository.exists, EventPublisher transaccional | Reglas, permisos por pertenencia y eventos dentro del commit |
| Adaptador negocio | BusinessRepository | PostgreSQL negocio | SQL parametrizado, transacciones, índices y exclusión de solapamientos |
| Adaptador identidad | IdentityRepository | PostgreSQL identidad | Usuarios, hashes y roles; nunca contraseñas en Cliente |
| PgOutboxPublisher | EventPublisher | Conexión de la transacción de negocio | Persistir el evento pendiente atómicamente con el cambio |
| OutboxDispatcher | Entrega de pendientes | PostgreSQL outbox, EventPublisher de transporte | Polling, exclusión de consumidores, reintentos persistentes y confirmación |
| Adaptador eventos HTTP | EventPublisher | POST /events | Transporte autenticado y timeout por intento |
| Registro de eventos | POST /events | SQLite log | Validación de contrato, deduplicación y persistencia antes de confirmar |

Las interfaces arquitectónicas REST/negocio agrupan operaciones de clases concretas; las fronteras sustituibles sí tienen interfaces TypeScript explícitas (BusinessRepository, IdentityRepository y EventPublisher). No se agregan abstracciones por cada clase.

Los DTOs de respuesta son ClienteDTO, VehiculoDTO y ReservaDTO con los campos mínimos del enunciado. LoginRequest tiene email/password y AuthResponse accessToken/expiresIn. EventoAuditoriaDTO tiene eventId, tipo, entidad, entidadId, userId y fechaHora. Las fechas se intercambian en ISO 8601 y UTC. Entradas de alta/edición separan IDs generados y vínculos inmutables; ver README para contratos HTTP completos.

### Flujo de identidad y pertenencia

1. Credenciales → IdentityService → IdentityRepository → base propia de usuarios.
2. Verificar scrypt y emitir JWT HS256, sub=userId, role, issuer, audience y expiración de una hora.
3. El middleware valida firma, algoritmo permitido, issuer, audience y vigencia en cada solicitud.
4. La consulta global verifica ADMIN antes de ejecutar el repositorio.
5. Para una consulta propia, Negocio busca Cliente.identityUserId=sub y usa su id como filtro. No acepta un clienteId de query para sustituir esa identidad.
6. Para modificar recursos, compara el cliente resuelto con el propietario del vehículo o el reservante. Ser dueño del vehículo no da permiso sobre reservas ajenas.

### Integridad y persistencia

Todo vehículo tiene un propietario. Una reserva pertenece al reservante y usa un vehículo ajeno. El propietario es inmutable en esta entrega. Las reservas activas usan intervalos semiabiertos [inicio,fin). PostgreSQL aplica CHECK temporal y EXCLUDE GiST con btree_gist; la integridad se conserva entre workers y al modificar fechas. Cancelar libera el intervalo, mantiene el historial y no permite reactivar. Las bajas referenciadas fallan, sin cascadas.

Las transacciones encapsulan cambios, verificaciones relevantes y persistencia del evento pendiente. BusinessRepository.transaction entrega repositorio y EventPublisher sobre la misma conexión: se confirman ambos o se revierten ambos. La base operacional conserva tres entidades de dominio en public y agrega una cuarta tabla física técnica, integration.outbox, según la decisión explícita de ADR-02. El log final permanece en SQLite independiente.

Un publicador consulta los pendientes con FOR UPDATE SKIP LOCKED y confirma la entrega después de recibir 204 del receptor. Ante fallo, persiste el intento y su próxima fecha con backoff; después de reiniciar retoma el trabajo. Si cae tras el acuse pero antes de marcar delivered_at, el receptor deduplica el reenvío. La entrega es eventual, al menos una vez y sin orden estricto; presupone conservación del almacenamiento y recuperación de las dependencias.

### Tecnologías

TypeScript estricto, Node.js y Express mantienen el estilo de clase. Zod define validaciones de entrada. pg y SQL explícito evitan un ORM adicional y hacen visible la integridad. PostgreSQL aporta transacciones y coordinación entre procesos. PM2 cluster distribuye la API; su número de workers es configurable. El pool tiene 10 conexiones por worker y 10 de identidad como máximo, sin abrir conexiones de identidad en cada consulta: JWT se valida localmente. El publicador fork tiene un pool adicional de dos conexiones y mantiene un lock durante cada intento HTTP acotado a 1,5 s. SQLite conserva el log con un escritor. k6 mide un tráfico abierto y registra descartes.

## A2. Escenarios de calidad

### Performance

- Fuente: clientes y administradores autenticados.
- Estímulo: 500 solicitudes/s de consultas de reservas propias y globales filtradas.
- Artefacto: API, repositorio e índices de reservas.
- Ambiente: operación normal, dependencias disponibles, dataset de 20 clientes, 100 vehículos y 10.000 reservas; carga y servidores comparten equipo local.
- Respuesta: responder consultas autorizadas y paginadas sin errores inesperados.
- Medida: p95 < 300 ms, cero iteraciones descartadas a la tasa ofrecida y cero errores durante 60 s estables, luego de calentamiento.
- Tácticas SAP: introducir concurrencia (workers PM2), administrar recursos (pools y límites de página) y reducir demanda computacional (índices, consulta parametrizada y reutilización de clave JWT).
- Ubicación: ecosystem.config.cjs, db.ts, sql/business.sql, identity.ts y repository.ts.
- Verificación: load/queries.js y scripts/run-load.ps1; resultados completos en RESULTADOS.md. El ensayo con outbox activo, dos workers y 300 VUs preasignados cumplió: 500 consultas/s durante 60 s, p95 de 25,67 ms, cero errores y cero iteraciones descartadas. La evidencia aplica al ambiente y dataset descritos; no se atribuye la diferencia respecto del ensayo previo a una mejora de consultas causada por outbox.

### Integrabilidad y modificabilidad

- Fuente: docente/equipo que solicita reemplazar el transporte de auditoría.
- Estímulo: sustituir HTTP por otro adaptador o un broker, manteniendo EventoAuditoriaDTO.
- Artefacto: frontera EventPublisher y composición audit/worker.ts.
- Ambiente: mantenimiento sobre la versión de esta entrega.
- Respuesta: agregar el adaptador y cambiar su composición; las reglas de CRUD y los contratos REST mantienen su comportamiento.
- Medida: cero cambios en service.ts, repository.ts y rutas HTTP; misma suite funcional aprobada y mismo esquema de eventos aceptado por un consumidor de prueba.
- Tácticas SAP: encapsular y restringir dependencias (modificabilidad); usar interfaces explícitas y un intermediario/adaptador para el transporte (integrabilidad).
- Ubicación: audit/publisher.ts, audit/outbox.ts, domain.ts, audit/worker.ts y receptor de eventos.
- Verificación prevista: prueba de contrato común para cada nuevo adaptador y suite de integración. El transporte HTTP actual ya se prueba; el cambio a un broker no se considera implementado ni medido.

## A3. Decisión sobre eventos

Ver ADR-02.md: outbox transaccional y publicador independiente, comparado con HTTP posterior al commit y publicación directa en RabbitMQ. ADR-01.md conserva la decisión inicial, reemplazada al incorporar entrega durable. La cuarta tabla física técnica se declara explícitamente y debe justificarse al presentar la restricción de tres entidades de negocio.

## A4. Trazabilidad y revisión

| Requisito | Ubicación | Evidencia |
|---|---|---|
| RF1 | clientes en BusinessService + rutas ADMIN | CRUD temporal y rechazo CLIENTE |
| RF2 | vehículos + owner() | CRUD propio, rechazo ajeno, baja referenciada |
| RF3 | reservas y exclusión PostgreSQL | alta, edición, cancelación, carrera y contiguos |
| RF4 | mine() + filtro propio | rechazo clienteId suministrado y pertenencia |
| RF5 | requireAdmin() + ReservaFilter | rechazo CLIENTE y filtros globales |
| JWT e identidad propia | IdentityService + base separada | login, firma, expiración y audiencia |
| Log independiente | EventPublisher + receptor SQLite | evento de alta, deduplicación, cancelación y secreto |
| Entrega durable | Outbox transaccional + proceso publicador | rollback, procesos muertos, receptor caído, reinicio y deduplicación |
| Performance | PM2, índices y k6 | referencia fallida conservada; ensayo final aprobado con dos workers |
| Modificabilidad | EventPublisher y audit/worker.ts | transporte sustituible sin modificar CRUD ni HTTP de negocio |

Decisiones derivadas de la aclaración del docente: una tabla Cliente, papeles no excluyentes y prohibición de reservar un auto propio. Decisiones simplificadoras: sin transferencia de vehículo ni cambio de reservante, sin eliminación de reservas, sin registro público de usuarios ni renovación/revocación de tokens. Una eliminación de Cliente deja la identidad independiente sin acceso a negocio; no se hace borrado distribuido automático.

La implementación de outbox incorpora pruebas de caída real de procesos y recuperación. La entrega durable presupone conservar los volúmenes, volver a ejecutar el publicador y reparar fallos permanentes; no implementa retención automática ni orden estricto. Los escenarios y sus mediciones se registran en RESULTADOS.md. Antes de una exposición fuera de localhost se necesitaría HTTPS y controles de abuso del login; esa exposición no forma parte de la demo local.

Referencias: enunciado SmartParking Parte 1; aclaraciones del docente transmitidas por el usuario; Bass, Clements y Kazman, Software Architecture in Practice, 4.ª ed.; documentación oficial de PostgreSQL (rangos y btree_gist) y PM2 (cluster mode).
