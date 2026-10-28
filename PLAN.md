# SmartParking: plan de implementación

## Alcance acordado

Implementación educativa en TypeScript, Node.js y Express, con interfaz web mínima, documentación de arquitectura, pruebas funcionales y mediciones con k6. PM2 distribuirá solicitudes entre procesos. Se seguirá el estilo del proyecto Practico Arquitectura: TypeScript estricto, validación con Zod, interfaces pequeñas y composición explícita de dependencias.

La aclaración del docente prevalece sobre la regla de pertenencia del PDF: el cliente de una reserva es quien reserva y debe ser distinto del propietario del vehículo. Un mismo cliente puede desempeñar ambas funciones.

## Modelo y reglas

- Base operacional: solamente Cliente, Vehiculo y Reserva.
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

Esto reemplaza la propuesta inicial de SQLite: PM2 y la carga objetivo justifican validar primero PostgreSQL. No se necesita un ORM si SQL parametrizado y repositorios pequeños resultan más fáciles de comprender. No se agregarán tablas de negocio auxiliares sin revisar la restricción del enunciado.

### Auditoría: decisión pendiente del ADR y prototipo

Comparar dos alternativas reales: invocación síncrona al componente de log y publicación mediante una cola persistente con consumidor independiente. Para la alternativa con cola, evaluar RabbitMQ, confirmaciones de publicación, mensajes persistentes, acknowledgements del consumidor, reintentos y deduplicación por eventId. El almacenamiento del log estará fuera de las bases de negocio e identidad.

Una cola por sí sola no hace atómica la escritura del negocio y la publicación. El prototipo debe demostrar qué ocurre si el proceso falla después del commit o el componente de eventos no está disponible. No declarar entrega garantizada sin resolver esa ventana. Un outbox relacional agregaría otra tabla, por lo que no se incorporará silenciosamente: se deberá justificar compatibilidad con la consigna o documentar el límite y consultar si fuera necesario.

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
- A3: ADR-01 sobre comunicación de eventos, alternativas, decisión, atributos afectados y consecuencias, incluida consistencia ante fallos.
- A4: matriz breve RF/componente/prueba y revisión de coherencia entre código, UML, escenarios y ADR.
- Generar el PDF final desde fuentes editables cuando las decisiones estén verificadas.

## Criterio educativo y modificabilidad

Comentarios en español para reglas, transacciones, concurrencia, autorización y decisiones no evidentes. Evitar comentarios que repitan el código. No crear repositorios genéricos, buses propios ni interfaces para cada clase. Usar interfaces donde existe una frontera real: almacenamiento, identidad y auditoría.

No se anticiparán funcionalidades desconocidas de la próxima parte. Se facilitará su incorporación mediante módulos cohesionados, contratos explícitos y pruebas de comportamiento.

## Estado al finalizar esta iteración

- Consigna y ejemplo de clase revisados.
- Node.js, npm, PM2, k6 y Docker encontrados en el equipo; falta verificar versiones y disponibilidad efectiva de servicios.
- Implementados estructura, RF1–RF5, identidad, auditoría HTTP, interfaz mínima, seed y configuración PM2/k6.
- Cuatro pruebas unitarias y nueve pruebas/subpruebas de integración pasaron nuevamente con la optimización JWT, incluyendo carrera en dos workers.
- Primera carga con un worker: no cumple p95 ni tasa sostenida; evidencia conservada en results/ y docs/RESULTADOS.md.
- Optimización de clave JWT validada; comparación de uno y dos workers documentada. Se corrigió el script PM2/PowerShell y se preasignaron 300 VUs en k6 sin reducir tasa ni flexibilizar umbrales.
- Ensayo final con dos workers: 500 consultas/s durante 60 s, p95 de 242,75 ms, cero errores y cero iteraciones descartadas. Evidencia conservada en results/ y docs/RESULTADOS.md.
- Pendientes de la entrega general: revisar la garantía de auditoría ante caída abrupta y preparar/revisar el PDF final. La garantía de auditoría sigue explícitamente limitada.
