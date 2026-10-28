# SmartParking: plan de implementación

## Alcance acordado

Implementación educativa en TypeScript, Node.js y Express, con interfaz web mínima, documentación de arquitectura, pruebas funcionales y mediciones con k6. PM2 distribuirá solicitudes entre procesos. Se seguirá el estilo del proyecto Practico Arquitectura: TypeScript estricto, validación con Zod, interfaces pequeñas y composición explícita de dependencias.

La aclaración del docente prevalece sobre la regla de pertenencia del PDF: el cliente de una reserva es quien reserva y debe ser distinto del propietario del vehículo. Un mismo cliente puede desempeñar ambas funciones.

## Modelo y reglas

- Entidades de negocio: Cliente, Vehiculo y Reserva. ADR-02 incorpora una cuarta tabla física técnica, integration.outbox, para entrega durable.
- Cliente: id, nombre, email, telefono e identityUserId único.
- Vehiculo: id, matricula única, marca, modelo y clienteId del propietario obligatorio.
- Reserva: id, clienteId del reservante, vehiculoId, inicio, fin y estado ACTIVA o CANCELADA.
- inicio < fin; intervalos [inicio, fin): una reserva puede comenzar cuando termina otra.
- No se permiten reservas activas solapadas para el mismo vehículo, incluso entre procesos PM2.
- El cliente autenticado se obtiene mediante identityUserId; no se confía en un clienteId de entrada para determinar su identidad.
- ADMIN gestiona clientes, vehículos y reservas y consulta reservas globales con filtros.
- CLIENTE gestiona sus vehículos y sus reservas; ser propietario no habilita a modificar reservas ajenas.
- Los clientes pueden consultar el catálogo mínimo de vehículos ajenos necesario para reservar, sin exponer datos personales de propietarios.
- Las eliminaciones con referencias se rechazan con conflicto; no se eliminan reservas en cascada. Las reservas se cancelan.
- Cada operación exitosa que modifica negocio genera un evento de auditoría, incluidas las bajas del CRUD.
- Fechas intercambiadas en ISO 8601 con zona horaria y almacenadas en UTC.

## Arquitectura propuesta

Monolito modular: clientes, vehículos, reservas, identidad y auditoría. Rutas y middleware HTTP llaman a servicios; los servicios dependen de interfaces de repositorios y publicación de eventos. Los adaptadores implementan persistencia y comunicación. main.ts compone las dependencias sin contenedor de inyección.

La identidad tendrá almacenamiento independiente y autenticación propia: usuarios, hash de contraseñas y roles. No se almacenan contraseñas en Cliente. La validación del JWT verifica firma, algoritmo esperado y vencimiento; la autorización por rol se realiza en middleware y la pertenencia en los servicios.

Para la interfaz se usará HTML, CSS y JavaScript sin framework; se servirá desde Express. Tendrá login, listados y formularios básicos, mensajes de error y acciones por rol.

### Persistencia: decisión a validar temprano

Se propone PostgreSQL para negocio por su soporte de concurrencia entre procesos y restricciones de exclusión para impedir solapamientos. La restricción combina vehiculoId e intervalo temporal y aplica solamente a reservas ACTIVA. Se verificará disponibilidad de la extensión necesaria. Una segunda base independiente almacenará identidad, con conexión y credenciales separadas.

Esto reemplaza la propuesta inicial de SQLite: PM2 y la carga objetivo justifican PostgreSQL. Se usa SQL parametrizado y repositorios pequeños. La incorporación posterior de integration.outbox se documenta explícitamente en ADR-02: estado técnico en la misma base para compartir el commit, conservando las tres entidades de negocio.

### Auditoría: decisión vigente ADR-02

Se compararon HTTP posterior al commit, publicación directa en RabbitMQ y outbox transaccional. Se implementó outbox con polling y transporte HTTP al log independiente. El CRUD persiste cambio y evento pendiente en una sola transacción; un proceso PM2 separado entrega con deduplicación por eventId.

La cuarta tabla física técnica se declara como decisión del equipo en ADR-02. La garantía es al menos una vez mientras se conserven los volúmenes y se recuperen las dependencias. Se prueban caídas después del commit y después de confirmar recepción, rollback conjunto, receptor caído, reinicio y consumidores concurrentes.

PM2 no ejecutará un consumidor de archivo por cada worker: el componente de log tendrá un único escritor o un almacenamiento que soporte concurrencia.

## Etapas y criterios de aceptación

### 1. Preparación y esqueleto

- Crear package.json, tsconfig estricto, configuración por entorno y .env.example sin secretos reales.
- Definir módulos, errores HTTP comunes y DTOs de entrada/salida.
- Preparar comandos de compilación, ejecución y pruebas; configuración PM2 y entorno de persistencia reproducible.
- Aceptación: compila y arranca; conexiones y configuración se validan al inicio.

### 2. Corte vertical y viabilidad técnica

- Implementar login, consulta autenticada y creación de reserva con persistencia real.
- Implementar restricción de solapamiento y validar solicitudes simultáneas contra dos procesos.
- Prototipar comunicación con auditoría y documentar fallos observados.
- Ejecutar una prueba k6 inicial antes de construir toda la UI.
- Aceptación: autenticación funcional, una sola reserva aceptada ante una carrera por el mismo intervalo y resultados de carga iniciales guardados.

### 3. Funcionalidades completas

- RF1: CRUD de clientes exclusivo de ADMIN.
- RF2: CRUD de vehículos propios o gestión por ADMIN.
- RF3: crear, modificar, cancelar y consultar reservas propias o gestión por ADMIN.
- RF4: consulta propia derivada del JWT.
- RF5: consulta global exclusiva de ADMIN, con filtros por cliente, estado y fechas.
- Agregar paginación con tamaño máximo e índices a partir de las consultas reales.
- Definir filtro temporal por intersección con el período consultado y documentarlo.
- Aceptación: casos de uso y errores cubiertos mediante pruebas significativas.

### 4. Interfaz y demostración

- Agregar interfaz web mínima y datos de ejemplo reproducibles.
- Incluir administrador y al menos dos clientes con vehículos y reservas.
- Aceptación: desde el navegador se puede iniciar sesión, administrar según permisos y reservar un vehículo ajeno.

### 5. Verificación funcional y carga

- Pruebas de credenciales, token inválido/vencido, rol y pertenencia.
- Pruebas de fechas, reservas propias prohibidas, cancelación, modificación y solapamientos concurrentes.
- Pruebas de filtros, eliminación con referencias y auditoría de operaciones exitosas.
- k6 con constant-arrival-rate para generar 500 solicitudes/s de consultas de negocio; login en preparación, fuera de la medición de consultas.
- Escenarios de consultas propias y globales con filtros, clientes y datos variados; evitar medir únicamente health checks o un recurso vacío.
- Threshold de p95 < 300 ms para consultas; cero errores inesperados y cero iteraciones descartadas durante el tramo estable como criterios adicionales del proyecto.
- Separar calentamiento y medición; comparar un proceso y varios workers PM2 sobre el mismo conjunto de datos.
- Registrar CPU, RAM, versiones, cantidad de workers, tamaño del dataset, duración y conexiones máximas por worker. El pool total no debe exceder la capacidad de la base.
- Guardar scripts y resultados. Reportar honestamente si el entorno disponible no alcanza el objetivo; no confundir configuración con cumplimiento medido.

### 6. Documentación y entrega

- README con instalación, variables, arranque, usuarios de demostración, pruebas y límites conocidos.
- A1: UML de componentes con interfaces provistas/requeridas, dependencias, tecnologías y persistencias separadas.
- A2: escenario de performance y escenario de cambio de mecanismo de auditoría; estímulo, ambiente, respuesta, medida, táctica SAP y ubicación concreta.
- A3: ADR-01 como antecedente y ADR-02 como decisión vigente de entrega durable, con alternativas, atributos afectados y consecuencias.
- A4: matriz breve RF/componente/prueba y revisión de coherencia entre código, UML, escenarios y ADR.
- Generar el PDF final desde fuentes editables cuando las decisiones estén verificadas.

## Criterio educativo y modificabilidad

Comentarios en español para reglas, transacciones, concurrencia, autorización y decisiones no evidentes. Evitar comentarios que repitan el código. No crear repositorios genéricos, buses propios ni interfaces para cada clase. Usar interfaces donde existe una frontera real: almacenamiento, identidad y auditoría.

No se anticiparán funcionalidades desconocidas de la próxima parte. Se facilitará su incorporación mediante módulos cohesionados, contratos explícitos y pruebas de comportamiento.

## Estado al finalizar esta iteración

- Consigna y ejemplo de clase revisados.
- Node.js, npm, PM2, k6 y Docker verificados; bases, API, receptor y publicador ejecutados en la demo.
- Implementados estructura, RF1–RF5, identidad, auditoría HTTP, interfaz mínima, seed y configuración PM2/k6.
- Cinco pruebas unitarias, nueve pruebas/subpruebas de integración general y siete de durabilidad aprobadas, incluyendo carrera en dos workers y muerte real de procesos auxiliares.
- Primera carga con un worker: no cumple p95 ni tasa sostenida; evidencia conservada en results/ y docs/RESULTADOS.md.
- Optimización de clave JWT validada; comparación de uno y dos workers documentada. Se corrigió el script PM2/PowerShell y se preasignaron 300 VUs en k6 sin reducir tasa ni flexibilizar umbrales.
- Ensayo con outbox activo y dos workers: 500 consultas/s durante 60 s, p95 de 25,67 ms, cero errores y cero iteraciones descartadas. Evidencia publicable en results/public/ y docs/RESULTADOS.md.
- Implementada entrega durable según ADR-02; documentadas la cuarta tabla física, la entrega eventual y sus condiciones. Pendiente de la entrega general: preparar/revisar el PDF final.

## Pendientes para cerrar la entrega

1. Renderizar el UML y armar/revisar visualmente el PDF con A1–A4, incluyendo ADR-02 y la justificación de la tabla técnica.
2. Verificar instalación y arranque desde un clon limpio siguiendo solamente el README.
3. Recorrer manualmente todos los formularios de administrador y cliente; la verificación de navegador realizada hasta ahora cubre login, catálogo y listados.
4. Publicar los nuevos commits en GitHub cuando corresponda y, al cerrar los puntos anteriores, considerar una etiqueta de referencia para la próxima parte.

No se requiere agregar funcionalidades para esos puntos. La retención automática de eventos entregados y una prueba de capacidad de escrituras/backlog son mejoras posteriores, distintas del requisito de carga de consultas ya verificado.
