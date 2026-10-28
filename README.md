# SmartParking

Proyecto educativo de arquitectura de software. Implementación en TypeScript estricto, Node.js y Express, con monolito modular, PostgreSQL para negocio e identidad en servidores separados y un componente HTTP independiente de auditoría.

## Estado

Implementados RF1–RF5, interfaz mínima, JWT, controles de pertenencia, concurrencia en PostgreSQL, PM2, scripts k6 y entrega durable de auditoría mediante outbox transaccional. Ver docs/RESULTADOS.md para la verificación y sus condiciones.

La prueba de carga con outbox activo **cumplió en el entorno local medido**: 500 consultas/s durante 60 s, p95 de 25,67 ms, cero errores y cero iteraciones descartadas, con dos workers PM2 y 300 usuarios virtuales preasignados en k6. Se aprobaron cinco pruebas unitarias, nueve pruebas/subpruebas de integración general y siete de durabilidad. La referencia inicial fallida y los ensayos intermedios se conservaron; ver docs/RESULTADOS.md para condiciones y comparación.

La API quedó ejecutándose con dos workers y el código optimizado verificado. El cumplimiento observado corresponde al dataset y a la mezcla de consultas documentados; no garantiza el mismo resultado en cualquier hardware o carga.

Las copias publicables de las mediciones están en `results/public/`. Los JSON originales de k6 incluyen datos de setup con tokens de la demo y permanecen ignorados por Git. `npm.cmd run results:export` genera copias que conservan métricas, checks y metadatos del entorno, excluyendo datos de sesión.

## Requisitos y ejecución

- Node.js 24 o posterior (el log usa `node:sqlite`, experimental en esta versión).
- Docker Desktop iniciado y puertos locales 5434/5435 disponibles.
- k6 para carga; PM2 está incluido como dependencia de desarrollo.
- PowerShell 7 para los scripts de comparación de carga.

```powershell
npm.cmd ci
Copy-Item .env.example .env
docker compose up -d --wait
npm.cmd run db:setup
npm.cmd run seed
npm.cmd run build
$env:PM2_HOME = Join-Path (Get-Location).Path 'data\pm2'
npm.cmd run pm2:start
```

Abrir http://localhost:3000. Antes de reutilizar las instrucciones, comprobar si `.env` ya existe: no sobrescribir una configuración propia. Los valores de `.env.example` son exclusivamente locales; las contraseñas de los contenedores deben coincidir con las URL de conexión.

Usuarios demo: `admin@demo.local` y `cliente1@demo.local` a `cliente20@demo.local`. Contraseña inicial definida por `DEMO_PASSWORD` en `.env`. El seed agrega 20 clientes, 100 vehículos y 10.000 reservas para enero de 2030, sin borrado previo. Repetirlo no restablece contraseñas existentes. Los nombres y vehículos son ficticios.

El frontend es deliberadamente básico: elegir un vehículo del catálogo, indicar fechas y guardar. Las fechas ingresadas son locales y se envían en UTC. El administrador puede crear una identidad de cliente y luego vincularla a un registro Cliente; ambos pasos están separados porque se persisten en componentes diferentes. Un fallo al crear el Cliente permite reutilizar el ID de la identidad ya creada.

Para ejecutar sin PM2: `npm.cmd run audit`, `npm.cmd run outbox` y `npm.cmd start`, cada uno en una terminal. `npm.cmd run dev` observa cambios de la API. No ejecutar simultáneamente dos servidores sobre el mismo puerto. Al actualizar desde la versión inicial, ejecutar `npm.cmd run db:setup` antes de compilar y recargar PM2: la migración agrega el outbox sin borrar datos.

## Pruebas

```powershell
npm.cmd test
# Requiere bases inicializadas, API, auditoría y publicador outbox ejecutándose:
$env:EXPECT_WORKERS = '2'
npm.cmd run test:integration
# Usa una base efímera y procesos aislados; no detiene la demo:
npm.cmd run test:outbox
# Crea resultados JSON y metadatos; deja PM2 con la cantidad solicitada:
.\scripts\run-load.ps1 -Instances 1 -Duration 60s
.\scripts\run-load.ps1 -Instances 2 -Duration 60s
```

La integración crea registros temporales mediante la API y elimina sus datos de negocio al terminar; conserva los eventos de auditoría. Usar únicamente las bases de demostración del proyecto. EXPECT_WORKERS comprueba que la carrera alcanzó varios procesos, además de comprobar el resultado de las reservas.

La prueba de outbox crea una base con prefijo `sp_outbox_test_` en el servidor de negocio y la elimina al finalizar; requiere permiso de crear bases (disponible en el contenedor local). Prueba rollback conjunto, procesos muertos después del commit y después de confirmar recepción, receptor caído, reinicio del publicador y consumidores concurrentes. Las muertes se provocan en procesos auxiliares de prueba, sin hooks en producción.

k6 separa 10 s de calentamiento, una pausa de 2 s y 60 s de carga estable. Cada iteración estable es una consulta autenticada: 75% propias y 25% globales, variando cliente, estado y offset. Los 21 logins ocurren en setup y no forman parte del p95 etiquetado `phase:steady`. Los filtros usan intersección temporal `[desde,hasta)`. Se exige p95 < 300 ms, cero respuestas fallidas, checks correctos y cero iteraciones descartadas. No alcanza con ofrecer 500/s si k6 descarta iteraciones. Se preasignan 300 usuarios virtuales para evitar crearlos durante la medición, manteniendo el máximo anterior. Hardware y JSON se guardan en `results/`; las nuevas ejecuciones también registran el hash del script y la asignación de VUs.

## API y permisos

Todas las rutas de negocio requieren `Authorization: Bearer <JWT>` y JSON. Las listas devuelven arrays, con `limit` (1–100, predeterminado 20) y `offset` (predeterminado 0). PUT reemplaza los campos editables; no hay PATCH. Los UUID no pueden intercambiarse por índices de listas.

| Método y ruta | Acceso / contrato |
|---|---|
| POST /api/auth/login | Público; email, password → accessToken, expiresIn |
| GET /api/auth/me | Identidad autenticada y cliente vinculado si es CLIENTE |
| POST /api/auth/users | ADMIN; email, password → identidad CLIENTE; no acepta rol |
| GET, POST /api/clientes | ADMIN; alta: nombre, email, telefono, identityUserId |
| GET, PUT, DELETE /api/clientes/:id | ADMIN; edición: nombre, email, telefono |
| GET, POST /api/vehiculos | Propios o todos para ADMIN; alta: matricula, marca, modelo; ADMIN agrega clienteId |
| GET, PUT, DELETE /api/vehiculos/:id | Propietario o ADMIN; edición: matricula, marca, modelo |
| GET /api/catalogo | Vehículos ajenos para CLIENTE; todos para ADMIN; sin clienteId ni datos personales |
| GET /api/reservas | Propias, derivadas de identityUserId; rechaza clienteId en query |
| GET /api/admin/reservas | ADMIN; filtros clienteId, estado, desde, hasta |
| POST /api/reservas | vehiculoId, inicio, fin; ADMIN agrega clienteId del reservante |
| GET /api/reservas/:id | Reservante o ADMIN |
| PUT /api/reservas/:id | Reservante o ADMIN; inicio, fin; solo ACTIVA |
| POST /api/reservas/:id/cancelar | Reservante o ADMIN; sin cuerpo; cancelación idempotente |

Consultas propias también aceptan estado, desde y hasta. ADMIN utiliza la ruta global para RF5; no tiene Cliente implícito. Los DTOs de respuesta mantienen los campos mínimos de la consigna. Los contratos de entrada separan campos generados e inmutables: no se cambia propietario, identidad del cliente, reservante ni vehículo de una reserva mediante PUT.

Errores: 400 validación, 401 identidad, 403 permisos, 404 registro inexistente, 409 integridad/solapamiento, 503 dependencia temporalmente indisponible y 500 inesperado. Se conserva la reserva ante cancelación; las bajas con referencias se rechazan. Email de negocio y email de login son datos separados: editar uno no modifica el otro.

## Estructura y decisiones

- `src/business`: casos de uso e interfaz/adaptador PostgreSQL.
- `src/identity`: hash scrypt, repositorio de usuarios, login y JWT HS256.
- `src/audit`: contrato EventPublisher, outbox, publicador durable, adaptador HTTP y receptor con SQLite independiente.
- `src/http`: validación, middleware y rutas; sin SQL.
- `src/main.ts`: composición, conexiones y cierre de API.
- `sql/`: esquemas idempotentes; tres tablas de dominio y `integration.outbox` como cuarta tabla física técnica, según ADR-02.
- `public/`: UI sin framework ni build propio.
- `tests/`, `load/`, `scripts/`: pruebas funcionales y carga reproducible.
- `docs/`: arquitectura, ADR y resultados; `PLAN.md`: alcance y etapas acordadas.

La exclusión GiST combina vehículo e intervalo `[inicio,fin)` solo para reservas activas. PostgreSQL rechaza el solapamiento entre altas o modificaciones concurrentes. Los locks de fila coordinan cambios y cancelaciones; no se utilizan locks de memoria que fallen entre workers. Cada escritura y su evento pendiente comparten una transacción. El CRUD no espera HTTP; un proceso independiente realiza la entrega desde su propio pool.

## Auditoría durable

El receptor escucha solamente en loopback, verifica un secreto independiente y confirma después de persistir en `data/audit.sqlite`. Usa eventId único, WAL y escritura síncrona completa. Un solo proceso PM2 es dueño del log. Otro proceso, `smartparking-outbox`, consulta los pendientes y entrega por HTTP.

**El cambio y su evento pendiente se confirman juntos.** `BusinessRepository.transaction` proporciona el repositorio y un EventPublisher asociados a la misma conexión. Si falla guardar el evento, se revierte el cambio. Una respuesta exitosa confirma esa persistencia local; el evento puede llegar al log unos instantes después.

El publicador toma una fila con `FOR UPDATE SKIP LOCKED`, realiza un intento HTTP con timeout de 1.500 ms y marca `delivered_at` después del acuse. Si falla, conserva el evento, aumenta `attempts` y programa `next_attempt_at` con backoff de 1 a 60 s, sin límite de reintentos. El polling predeterminado es de 500 ms, configurable con `OUTBOX_POLL_MS`. Un reinicio retoma los pendientes; una caída después de que el receptor guardó puede provocar reenvío, deduplicado por `eventId`.

La garantía es entrega al menos una vez mientras se conserven los volúmenes y se recuperen el publicador/receptor. Las filas entregadas se conservan para inspección; no hay limpieza automática ni orden estricto de entrega. Un error permanente requiere intervención y puede acumular pendientes. Ver [ADR-02](docs/ADR-02.md) para la decisión y sus límites; ADR-01 conserva el antecedente.

Para revisar el backlog y sus errores desde PostgreSQL:

```sql
SELECT event_id, created_at, attempts, next_attempt_at, last_error
FROM integration.outbox
WHERE delivered_at IS NULL
ORDER BY created_at;
```

## Detener

```powershell
$env:PM2_HOME = Join-Path (Get-Location).Path 'data\pm2'
npm.cmd run pm2:stop
docker compose stop
```

Los volúmenes de PostgreSQL y el log quedan conservados. No usar `docker compose down -v` si se desea mantener los datos.
