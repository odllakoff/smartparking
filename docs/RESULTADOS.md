# Verificación - 28/10/2026

## Funcionalidad

La repetición fue autorizada y se completó. El código con reutilización de KeyObject para JWT volvió a aprobar las pruebas:

- Compilación TypeScript correcta.
- Cuatro pruebas unitarias aprobadas: scrypt, JWT, intervalos y reintentos/fallo de auditoría.
- Nueve pruebas/subpruebas de integración aprobadas con PostgreSQL real y dos workers PM2.
- Carrera repetida: 12 altas simultáneas del mismo intervalo, una respuesta 201 y once respuestas 409. Se observaron ambos procesos (PID 15052 y 10180 en la segunda ejecución).
- Verificación manual en navegador: login de cliente, vehículos, catálogo ajeno y listado de reservas visibles. Evidencia en interfaz.png. No se afirma haber probado manualmente cada formulario.
- npm audit tras actualizar PM2 a 7.1.1: cero vulnerabilidades reportadas en esa ejecución.

## Primera carga: referencia fallida

Archivo publicable: results/public/20261028-193007-1-workers.json y metadatos del mismo prefijo.

- Un worker de API, un proceso de auditoría y dos PostgreSQL en Docker.
- Equipo: AMD Ryzen 5 Microsoft Surface Edition, 6 núcleos / 12 hilos y aproximadamente 16,6 GB RAM decimal.
- Node v24.15.0; k6 v2.2.0; PostgreSQL 17-alpine; Windows con Docker Desktop.
- Dataset: 20 clientes, 100 vehículos, 10.000 reservas; veinte clientes y un administrador autenticados antes del escenario.
- Calentamiento: 100 consultas/s durante 10 s. Medición estable: tasa ofrecida de 500 consultas/s durante 60 s.
- Mezcla: 75% consultas propias y 25% globales, filtros por cliente/estado/fechas y paginación.
- p95 estable: 1.179,39 ms, superior a 300 ms.
- Iteraciones descartadas: 6.627. No se sostuvo la tasa objetivo.
- Cero errores HTTP en las consultas completadas; todos sus checks correctos.
- 24.375 consultas completadas incluyendo calentamiento; 23.374 respuestas de consulta durante el tramo estable según los contadores del informe.
- Los promedios globales de k6 incluyen calentamiento y setup: no se usan como evidencia de sostener 500/s.

## Ajustes y comparación

Se cambió IdentityService para construir una KeyObject una sola vez y reutilizarla al firmar/validar JWT. Evita el intento de interpretar la clave como PEM en cada request. La compilación, las cuatro pruebas unitarias y las nueve pruebas/subpruebas de integración pasaron nuevamente. Firma, algoritmo permitido, emisor, audiencia y vencimiento siguen verificándose.

| Ensayo | Workers | VUs preasignados/máximo | p95 estable | Descartes | Resultado |
|---|---:|---:|---:|---:|---|
| Referencia inicial, clave JWT string | 1 | 100/300 | 1.179,39 ms | 6.627 | No cumple |
| Clave JWT reutilizada | 1 | 100/300 | 764,45 ms | 1.044 | No cumple |
| Clave reutilizada y PM2 | 2 | 100/300 | 155,50 ms | 114 | No cumple por descartes |
| Clave reutilizada, PM2 y VUs preasignados | 2 | 300/300 | 242,75 ms | 0 | Cumple |

Todos los ensayos tuvieron cero errores HTTP y checks correctos para las consultas completadas. Un p95 correcto no compensa iteraciones descartadas.

Archivos JSON, con metadatos del mismo prefijo:

- results/public/20261028-193007-1-workers.json: referencia inicial.
- results/public/20261028-193910-1-workers.json: clave reutilizada, un worker.
- results/public/20261028-194053-2-workers.json: dos workers, asignación dinámica de VUs.
- results/public/20261028-194314-2-workers.json: ensayo final aprobado.

Estas copias conservan métricas, checks y metadatos del entorno. Se excluye setup_data porque contiene los tokens de sesión de la demo. Los originales permanecen intactos y fuera de Git; scripts/export-results.cjs permite regenerar las copias publicables.

Con dos workers y 100 VUs iniciales, el p95 cumplió pero hubo 114 descartes. Se preasignaron los 300 VUs permitidos para evitar el costo de crearlos durante el escenario. Se mantuvieron el máximo de 300, la tasa de 500/s, las consultas, la duración y todos los umbrales. Es un ajuste del generador, no una ampliación del servidor ni una flexibilización del criterio. La última medición tuvo mayor p95 que el ensayo anterior, pero aprobó todos los criterios.

La comparación de un worker antes/después de KeyObject registró menor p95 y menos descartes; el entorno local compartido introduce variabilidad y no se presenta como microbenchmark aislado de JWT.

## Resultado vigente y alcance

El ensayo final aprobó todos los umbrales: **500 consultas/s durante 60 s, p95 de 242,75 ms, cero errores y cero iteraciones descartadas**. Completó 30.001 consultas durante el tramo estable (variación de una iteración en el límite de temporización). Los aproximadamente 420 requests/s del promedio global mostrado por k6 incluyen setup, calentamiento y pausa; no son la tasa del escenario steady.

La API quedó ejecutándose con dos workers y la versión optimizada. Los resultados fallidos y sus metadatos se conservaron íntegros.

También se corrigió run-load.ps1 para no tratar como fallo un escalado PM2 a la cantidad ya existente y para leer JSON con claves de entorno que solo difieren en mayúsculas/minúsculas. Requiere PowerShell 7. Las siguientes ejecuciones registrarán además el hash del script de carga y los VUs preasignados; esos campos no se agregaron retroactivamente a resultados ya obtenidos.

El pool máximo es de 10 conexiones por base y por worker. La carga final tuvo dos workers, un proceso de auditoría y los dos PostgreSQL separados, sobre el mismo dataset. El resultado acredita el escenario local descrito durante un minuto estable, sin garantizar otros volúmenes, hardware o mezclas.

No se midió una carga de escrituras ni tolerancia a caídas de auditoría; sus límites siguen documentados en ADR-01.md. El mensaje AUDIT_DELIVERY_FAILED de la prueba unitaria es esperado: el receptor simulado devuelve 503 y se comprueban los tres reintentos y businessApplied.
