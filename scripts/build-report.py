"""Genera el informe A1-A4 y su figura UML vectorial desde fuentes locales.

Requiere Python con reportlab y pypdf. Ejecutar desde la raíz del proyecto.
Las páginas se componen explícitamente para facilitar su revisión educativa.
"""
from pathlib import Path
import json
import math
from xml.sax.saxutils import escape

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, NextPageTemplate,
)
from reportlab.graphics.shapes import Drawing, Rect, Circle, Line, String, Path as GPath
from reportlab.graphics import renderSVG
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output/pdf/SmartParking_Parte1_Equipo_RAT2.pdf'
FIGURE = ROOT / 'docs/diagramas/componentes.svg'
NAVY = colors.HexColor('#17374b')
TEAL = colors.HexColor('#167875')
INK = colors.HexColor('#243746')
MUTED = colors.HexColor('#526677')
LIGHT = colors.HexColor('#edf4f6')
LINE = colors.HexColor('#cfdbdf')
WHITE = colors.white
WIDTH = A4[0] - 88


def register_fonts():
    font_dir = Path('C:/Windows/Fonts')
    fonts = [('Body', 'segoeui.ttf'), ('Body-Bold', 'segoeuib.ttf'), ('Body-Italic', 'segoeuii.ttf')]
    for name, filename in fonts:
        pdfmetrics.registerFont(TTFont(name, str(font_dir / filename)))
    pdfmetrics.registerFontFamily('Body', normal='Body', bold='Body-Bold', italic='Body-Italic', boldItalic='Body-Bold')


register_fonts()
STYLES = {
    'body': ParagraphStyle('body', fontName='Body', fontSize=9.6, leading=13.2, textColor=INK, spaceAfter=7),
    'small': ParagraphStyle('small', fontName='Body', fontSize=8.2, leading=11, textColor=MUTED, spaceAfter=5),
    'cell': ParagraphStyle('cell', fontName='Body', fontSize=8.5, leading=11.4, textColor=INK),
    'cellSmall': ParagraphStyle('cellSmall', fontName='Body', fontSize=8, leading=10.7, textColor=INK),
    'headCell': ParagraphStyle('headCell', fontName='Body-Bold', fontSize=8.3, leading=11, textColor=WHITE),
    'label': ParagraphStyle('label', fontName='Body-Bold', fontSize=9, leading=12, textColor=TEAL, spaceAfter=6),
    'title': ParagraphStyle('title', fontName='Body-Bold', fontSize=24, leading=28, textColor=NAVY, spaceAfter=8),
    'h1': ParagraphStyle('h1', fontName='Body-Bold', fontSize=17, leading=21, textColor=NAVY, spaceAfter=9),
    'h2': ParagraphStyle('h2', fontName='Body-Bold', fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=7, spaceAfter=7),
    'callout': ParagraphStyle('callout', fontName='Body', fontSize=9.2, leading=12.6, textColor=NAVY),
}


def p(text, style='body'):
    return Paragraph(text, STYLES[style])


def heading(label, title):
    return [p(label, 'label'), p(title, 'h1')]


def table(headers, rows, widths, small=False):
    style = 'cellSmall' if small else 'cell'
    data = [[p(escape(x), 'headCell') for x in headers]]
    data += [[p(str(x), style) for x in row] for row in rows]
    t = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT]),
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, NAVY),
        ('LINEBELOW', (0, 1), (-1, -1), 0.35, LINE),
    ]))
    t.spaceAfter = 6
    return t


def callout(title, text, width=WIDTH):
    t = Table([[p(f'<b>{title}</b><br/>{text}', 'callout')]], colWidths=[width])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), LIGHT),
        ('LINEBEFORE', (0, 0), (0, 0), 3, TEAL),
        ('LEFTPADDING', (0, 0), (-1, -1), 12), ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ('TOPPADDING', (0, 0), (-1, -1), 10), ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    t.spaceAfter = 7
    return t


def text(d, x, y, value, size=8.5, bold=False, color=INK, anchor='middle'):
    d.add(String(x, y, value, fontName='Body-Bold' if bold else 'Body', fontSize=size, fillColor=color, textAnchor=anchor))


def component(d, x, y, w, h, title, lines):
    d.add(Rect(x, y, w, h, strokeColor=NAVY, strokeWidth=1, fillColor=WHITE))
    text(d, x + w/2 - 6, y+h-18, title, 9.5, True)
    for i, line in enumerate(lines):
        text(d, x+w/2, y+h-33-i*12, line, 8)
    # Símbolo UML de componente, sin agregar cajas decorativas al modelo.
    d.add(Rect(x+w-18, y+h-22, 11, 14, fillColor=WHITE, strokeColor=NAVY, strokeWidth=.7))
    for offset in [0, 7]:
        d.add(Rect(x+w-21, y+h-19+offset, 5, 4, fillColor=WHITE, strokeColor=NAVY, strokeWidth=.7))


def node(d, x, y, w, h, label):
    d.add(Rect(x, y, w, h, strokeColor=LINE, strokeWidth=.8, fillColor=LIGHT))
    text(d, x+9, y+h-13, label, 8, True, MUTED, 'start')


def cylinder(d, x, y, w, h, title, lines):
    # Cilindro de almacenamiento, con elipsis dibujadas como curvas vectoriales.
    d.add(Rect(x, y+5, w, h-10, fillColor=LIGHT, strokeColor=NAVY, strokeWidth=.8))
    for bottom in [y+5, y+h-5]:
        path = GPath(strokeColor=NAVY, strokeWidth=.8, fillColor=LIGHT)
        path.moveTo(x, bottom)
        path.curveTo(x, bottom+9, x+w, bottom+9, x+w, bottom)
        path.curveTo(x+w, bottom-9, x, bottom-9, x, bottom)
        path.closePath()
        d.add(path)
    text(d, x+w/2, y+h-23, title, 8.6, True)
    for i, line in enumerate(lines):
        text(d, x+w/2, y+h-35-i*10, line, 7.7)


def arrow(d, points, dashed=True, color=MUTED):
    for a, b in zip(points, points[1:]):
        d.add(Line(*a, *b, strokeColor=color, strokeWidth=.9, strokeDashArray=[3, 2] if dashed else None))
    a, b = points[-2:]
    angle = math.atan2(b[1]-a[1], b[0]-a[0])
    for delta in [-.48, .48]:
        tip = (b[0]-6*math.cos(angle+delta), b[1]-6*math.sin(angle+delta))
        d.add(Line(*b, *tip, strokeColor=color, strokeWidth=.9))


def provided(d, provider, circle):
    d.add(Line(*provider, *circle, strokeColor=NAVY, strokeWidth=.9))
    d.add(Circle(*circle, 4, fillColor=WHITE, strokeColor=NAVY, strokeWidth=.9))


def diagram():
    d = Drawing(744, 411)
    node(d, 140, 190, 600, 220, 'PM2 CLUSTER: 2 WORKERS DE API / MÓDULOS INTERNOS')
    node(d, 0, 0, 250, 90, 'PM2 FORK: PUBLICADOR / 1 PROCESO')
    node(d, 350, 0, 210, 90, 'PM2 FORK: RECEPTOR / 1 PROCESO')

    component(d, 0, 330, 110, 55, 'UI mínima', ['HTML / JS', 'navegador'])
    component(d, 155, 330, 145, 55, 'API HTTP', ['Express / Zod', 'Bearer / rol ADMIN'])
    component(d, 455, 330, 265, 55, 'Negocio', ['Clientes / Vehículos / Reservas', 'reglas / pertenencia / eventos'])
    component(d, 155, 205, 145, 70, 'Identidad propia', ['login / emitir / validar JWT', 'IdentityService', 'PgIdentityRepository'])
    component(d, 455, 205, 265, 70, 'Persistencia de negocio', ['PgBusinessRepository', 'PgOutboxPublisher', 'misma conexión de transacción'])
    component(d, 10, 10, 230, 55, 'Publicador durable', ['OutboxDispatcher / HttpEventPublisher', 'polling / backoff / reintentos'])
    component(d, 360, 10, 190, 55, 'Registro de eventos', ['validar / deduplicar / persistir', 'confirmar después de guardar'])

    provided(d, (155, 357), (130, 357))
    arrow(d, [(110,357),(126,357)])
    text(d, 65, 395, 'REST / DTOs', 8)
    provided(d, (455,357),(385,357))
    arrow(d, [(300,357),(381,357)])
    text(d, 378, 370, 'BusinessService', 8)
    provided(d, (225,275),(225,300))
    arrow(d, [(225,330),(225,304)])
    text(d, 235, 299, 'login / validate', 8, anchor='start')
    provided(d, (520,275),(520,300))
    arrow(d, [(520,330),(520,304)])
    text(d, 530, 300, 'BusinessRepository', 7.5, anchor='start')
    provided(d, (660,275),(660,300))
    arrow(d, [(660,330),(660,304)])
    text(d, 650, 285, 'EventPublisher (Tx)', 7.5, anchor='end')

    cylinder(d,155,115,145,52,'PostgreSQL identidad',['usuarios / hashes / roles'])
    cylinder(d,455,115,265,64,'PostgreSQL negocio',['public: Cliente / Vehículo / Reserva','integration.outbox: tabla técnica'])
    arrow(d,[(225,205),(225,167)],False)
    text(d,260,181,'SQL / pool',7.5)
    arrow(d,[(587,205),(587,179)],False)
    text(d,654,182,'SQL / commit local',7.5)
    arrow(d,[(125,65),(125,100),(587,100),(587,115)],True,TEAL)
    text(d,390,103,'leer pendientes / marcar delivered_at',7.6,color=TEAL)
    provided(d,(360,37),(315,37))
    arrow(d,[(240,37),(311,37)])
    text(d,299,57,'POST /events',8)
    text(d,299,24,'JSON + secreto',7.5)
    cylinder(d,595,8,125,52,'SQLite auditoría',['eventId único / WAL'])
    arrow(d,[(550,37),(595,37)],False)
    text(d,573,49,'SQL',7.5)
    text(d,14,222,'Interfaces:',8.4,True,anchor='start')
    d.add(Line(14,205,31,205,strokeColor=NAVY,strokeWidth=.9))
    d.add(Circle(35,205,4,fillColor=WHITE,strokeColor=NAVY,strokeWidth=.9))
    text(d,45,202,'provista',8,anchor='start')
    arrow(d,[(14,185),(39,185)])
    text(d,45,182,'requerida',8,anchor='start')
    text(d,14,161,'Flechas hacia bases:',8,True,anchor='start')
    text(d,14,149,'dependencia SQL.',8,anchor='start')
    return d


def decorate(canvas, doc):
    w,h = canvas._pagesize
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(44,h-38,w-44,h-38)
    canvas.setFillColor(MUTED)
    canvas.setFont('Body-Bold',8)
    canvas.drawString(44,h-29,'SMARTPARKING  /  PARTE 1')
    canvas.setFont('Body',8)
    canvas.drawRightString(w-44,h-29,'Equipo de RAT 2')
    canvas.line(44,34,w-44,34)
    canvas.setFont('Body',7.7)
    canvas.drawString(44,22,'Arquitectura de Software  |  28/10/2026  |  base de código: d86fe22')
    canvas.drawRightString(w-44,22,f'{doc.page} / 8')
    canvas.restoreState()


def make_report():
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    FIGURE.parent.mkdir(parents=True,exist_ok=True)
    latest_path = ROOT/'results/public/20261028-200851-2-workers.json'
    metrics = json.loads(latest_path.read_text(encoding='utf-8'))['metrics']
    p95 = metrics['http_req_duration{phase:steady}']['p(95)']
    assert p95 < 300 and metrics['dropped_iterations{scenario:steady}']['count'] == 0
    assert metrics['http_req_failed{phase:steady}']['value'] == 0
    assert metrics['checks{phase:steady}']['value'] == 1

    doc = BaseDocTemplate(str(OUTPUT),pagesize=A4,title='SmartParking - Parte 1 - Equipo de RAT 2',
        author='Equipo de RAT 2',subject='A1-A4: componentes, calidad, decisión de auditoría y consistencia',
        leftMargin=44,rightMargin=44,topMargin=55,bottomMargin=47)
    portrait_frame = Frame(44,47,WIDTH,A4[1]-102,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    land = landscape(A4)
    landscape_frame = Frame(44,47,land[0]-88,land[1]-102,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
    doc.addPageTemplates([
        PageTemplate(id='portrait',frames=[portrait_frame],onPage=decorate,pagesize=A4),
        PageTemplate(id='landscape',frames=[landscape_frame],onPage=decorate,pagesize=land),
    ])
    story=[]

    # Página 1: contexto y decisiones suficientes para interpretar el resto del informe.
    story += [p('ENTREGA GRUPAL / DISEÑO E IMPLEMENTACIÓN','label'),p('SmartParking','title'),
        p('Parte 1 · Diseño arquitectónico y decisiones','h1'),
        p('<b>Equipo de RAT 2</b> · 28 de octubre de 2026'),
        p('Solución educativa para administrar clientes, vehículos y reservas. Se implementa un monolito modular con autenticación propia, almacenamiento de identidad independiente y entrega durable de eventos al log.'),
        p('Alcance y reglas acordadas','h2'),
        table(['Entidad','Relación y regla principal'],[
            ['Cliente','Una única entidad permite actuar como propietario y como reservante. Cada registro se vincula a una identidad mediante identityUserId.'],
            ['Vehículo','Pertenece obligatoriamente a un cliente. Matrícula única. El propietario permanece fijo en esta entrega.'],
            ['Reserva','Vincula un vehículo con el cliente que lo reserva, distinto de su propietario. inicio &lt; fin; estados ACTIVA o CANCELADA.'],
        ],[80,WIDTH-80]),
        Spacer(1,9),
        callout('Aclaración del dominio','La regla de pertenencia del PDF original se interpreta con la aclaración del docente transmitida al equipo: un cliente reserva el auto de otro cliente. Una persona puede cumplir ambos papeles. Los intervalos son [inicio, fin): dos reservas contiguas son válidas.'),
        p('Elección tecnológica','h2'),
        table(['Herramienta','Justificación breve'],[
            ['TypeScript / Node.js / Express','Continuidad con el estilo de clase; módulos pequeños, contratos explícitos y validación con Zod.'],
            ['PostgreSQL + pg','Transacciones y restricción de exclusión para coordinar reservas entre procesos. SQL parametrizado sin un ORM adicional.'],
            ['PM2 / SQLite / k6','PM2 replica API y administra procesos; SQLite conserva el log independiente; k6 verifica el escenario de consultas.'],
        ],[143,WIDTH-143]),
        p('Lectura del informe','h2'),
        p('<b>A1</b> componentes y contratos: páginas 2-4. <b>A2</b> escenarios de calidad: página 5. <b>A3</b> decisión sobre comunicación de eventos: página 6. <b>A4</b> evidencia y revisión de consistencia: páginas 7-8.','small'),
        p('Repositorio y versión: <link href="https://github.com/odllakoff/smartparking/tree/d86fe22" color="#167875">github.com/odllakoff/smartparking · d86fe22</link>. El documento describe esa implementación; las pruebas y sus condiciones están versionadas.','small'),
    ]

    # Página 2: diagrama UML vectorial en A4 apaisado para mantener las etiquetas legibles.
    story += [NextPageTemplate('landscape'),PageBreak()]
    story += heading('A1 / COMPONENTES','Vista UML de componentes y persistencias')
    figure=diagram()
    renderSVG.drawToFile(figure,str(FIGURE))
    story += [figure,Spacer(1,5),p('Figura 1. Vista agrupada de la implementación. Los círculos representan interfaces provistas; las dependencias discontinuas indican interfaces requeridas. Identidad agrupa su servicio y adaptador SQL; Persistencia de negocio agrupa los dos adaptadores que comparten transacción. El log final conserva su almacenamiento independiente.','small')]

    # Página 3: contratos verificables, manteniendo los DTOs mínimos de la consigna.
    story += [NextPageTemplate('portrait'),PageBreak()]
    story += heading('A1 / INTERFACES','Contratos explícitos y datos de intercambio')
    story += [p('Las interfaces REST y de casos de uso son contratos arquitectónicos. BusinessRepository, IdentityRepository y EventPublisher son también interfaces TypeScript. No se requiere una interfaz por cada clase.'),
        table(['Contrato provisto','Consumidor y operaciones'],[
            ['REST de negocio / API HTTP','UI o cliente HTTP. CRUD de clientes y vehículos; crear, modificar, consultar y cancelar reservas. JSON con Bearer token. Listas paginadas (20 por defecto, máximo 100).'],
            ['IdentityService','API HTTP: login(email, password), validate(token). La validación devuelve userId y role; login devuelve AuthResponse.'],
            ['IdentityRepository','Identidad: findByEmail y create; Negocio: exists al vincular un Cliente. PgIdentityRepository accede solo al storage de identidad.'],
            ['BusinessRepository','BusinessService: búsquedas y CRUD. transaction(work) proporciona el repositorio y un EventPublisher sobre la misma conexión.'],
            ['EventPublisher.publish(event)','Dentro del CRUD, PgOutboxPublisher persiste el pendiente; dentro del publicador, HttpEventPublisher envía el mismo DTO al receptor.'],
            ['POST /events','HttpEventPublisher requiere JSON y secreto de servicio. Registro responde 204 después de persistir; 400 por contrato inválido y 401 por secreto incorrecto.'],
        ],[142,WIDTH-142]),
        p('DTOs mínimos de respuesta y comunicación','h2'),
        table(['DTO','Campos y tipos'],[
            ['ClienteDTO','id: UUID; nombre, email, telefono: string; identityUserId: string (UUID en la implementación).'],
            ['VehiculoDTO','id, clienteId: UUID; matricula, marca, modelo: string.'],
            ['ReservaDTO','id, clienteId, vehiculoId: UUID; inicio, fin: datetime; estado: ACTIVA | CANCELADA.'],
            ['LoginRequest / AuthResponse','email, password: string / accessToken: JWT; expiresIn: number (segundos).'],
            ['EventoAuditoriaDTO','eventId, entidadId: UUID; tipo, entidad, userId: string; fechaHora: datetime. userId se implementa como UUID.'],
        ],[142,WIDTH-142]),
        p('Entradas y errores','h2'),
        p('Las altas omiten IDs generados. Las ediciones aceptan campos editables y mantienen fijos propietario, identidad vinculada, reservante y vehículo de la reserva. Fechas ISO 8601 con zona horaria, normalizadas a UTC. Estados HTTP: 400 validación, 401 identidad, 403 permisos, 404 inexistente, 409 conflicto y 503 dependencia temporalmente indisponible.','small')]

    # Página 4: seguridad y secuencias del negocio sin detalles accesorios de endpoints.
    story += [PageBreak()]
    story += heading('A1 / SEGURIDAD Y FLUJOS','Identidad, permisos y operaciones exitosas')
    story += [p('Autenticación diseñada por el equipo','h2'),
        p('<b>1.</b> La API recibe credenciales y IdentityService busca el usuario en su repositorio propio. <b>2.</b> Compara la contraseña mediante scrypt con sal; Cliente no almacena credenciales. <b>3.</b> Emite JWT HS256 con sub=userId, role, issuer, audience y vencimiento de una hora.'),
        p('<b>4.</b> En cada solicitud, el middleware exige Bearer y verifica firma, algoritmo permitido, emisor, audiencia y vigencia. <b>5.</b> Para operaciones propias, Negocio resuelve Cliente por identityUserId=sub y compara la pertenencia. <b>6.</b> La consulta global exige ADMIN antes de acceder al repositorio.'),
        table(['Requisito / recurso','CLIENTE','ADMIN'],[
            ['RF1 · Clientes','Sin acceso al CRUD.','CRUD de clientes.'],
            ['RF2 · Vehículos','Gestiona sus vehículos. Catálogo ajeno mínimo para reservar.','Gestiona todos.'],
            ['RF3 · Reservas','Crea sobre vehículo ajeno; modifica y cancela sus reservas.','Gestiona reservas de cualquier cliente.'],
            ['RF4 · Consulta propia','Cliente derivado del JWT. clienteId en query se rechaza.','Usa la consulta global; no tiene Cliente implícito.'],
            ['RF5 · Consulta global','Acceso rechazado.','Filtros por cliente, estado y fechas.'],
        ],[132,215,WIDTH-347]),
        p('Crear una reserva y conservar su evento','h2'),
        p('<b>1.</b> Validar entrada e identidad. Obtener el reservante autenticado, salvo gestión explícita de ADMIN. <b>2.</b> Abrir transacción, verificar cliente y vehículo; rechazar auto propio. <b>3.</b> Guardar la reserva: PostgreSQL aplica CHECK de fechas y EXCLUDE GiST sobre vehículo e intervalo activo. Una carrera o edición solapada recibe 409.'),
        p('<b>4.</b> Guardar EventoAuditoriaDTO en integration.outbox mediante la misma conexión. Si falla, rollback de ambos cambios. <b>5.</b> Confirmar commit y responder a la API. <b>6.</b> El publicador entrega después al log y marca delivered_at tras el acuse. El receptor deduplica por eventId.'),
        callout('Semántica de las operaciones','La respuesta exitosa confirma negocio y evento pendiente. El log se actualiza de forma eventual. Cancelar conserva la reserva y libera su intervalo; repetir una cancelación no produce otro evento. Las bajas con referencias se rechazan sin cascadas.'),
        p('El propietario del vehículo no puede modificar reservas de terceros. Las altas de identidad son administrativas, sin registro público. El catálogo omite datos personales del propietario. Las claves de firma y del receptor se configuran fuera del código.','small')]

    # Página 5: escenarios con seis partes y tácticas ubicadas en el diseño.
    story += [PageBreak()]
    story += heading('A2 / CALIDAD','Dos escenarios verificables')
    story += [p('Escenario 1 · Performance de consultas','h2'),
        table(['Elemento','Definición'],[
            ['Fuente / estímulo','Clientes y administradores autenticados generan 500 consultas de reservas por segundo.'],
            ['Artefacto / ambiente','API, repositorio e índices; operación normal con dependencias disponibles. Dataset de 20 clientes, 100 vehículos y 10.000 reservas; generación y servicios en el equipo local documentado.'],
            ['Respuesta','Resolver consultas propias y globales filtradas, autorizadas y paginadas, sin errores inesperados.'],
            ['Medida','p95 &lt; 300 ms durante 60 s estables; además, cero iteraciones descartadas, cero fallos HTTP y todos los checks correctos.'],
            ['Táctica SAP / ubicación','Introducir concurrencia: dos workers PM2. Administrar recursos: pools y límite de página. Reducir demanda: índices, consultas acotadas y clave JWT reutilizada. Ubicación: ecosystem.config.cjs, db.ts, sql/business.sql, repository.ts e identity.ts.'],
            ['Verificación','k6 constant-arrival-rate. Ensayo vigente: p95 25,67 ms, cero errores y cero descartes; ver página 7.'],
        ],[105,WIDTH-105]),
        p('Escenario 2 · Integrabilidad y modificabilidad','h2'),
        table(['Elemento','Definición'],[
            ['Fuente / estímulo','Docente o equipo solicita sustituir el transporte HTTP de auditoría por otro adaptador o broker, manteniendo el contrato de evento.'],
            ['Artefacto / ambiente','Frontera EventPublisher y composición audit/worker.ts, durante mantenimiento de esta versión.'],
            ['Respuesta','Agregar el adaptador y sustituir su composición; preservar CRUD, autorización, persistencia de negocio y contratos REST.'],
            ['Medida','Cero cambios en service.ts, repository.ts y rutas HTTP; misma suite funcional aprobada y EventoAuditoriaDTO aceptado por una prueba de contrato del nuevo adaptador.'],
            ['Táctica SAP / ubicación','Encapsular y restringir dependencias: servicios aislados del transporte. Interfaces explícitas y adaptador intermediario: EventPublisher, domain.ts, audit/publisher.ts y audit/worker.ts.'],
            ['Verificación prevista','Ejecutar la prueba de contrato para cada adaptador incorporado y la integración general. El reemplazo por un broker es un escenario de cambio, no una funcionalidad ya implementada.'],
        ],[105,WIDTH-105]),
        p('Las medidas distinguen lo observado de lo propuesto. La carga de consultas ya se ejecutó; la sustitución por un broker queda preparada como cambio verificable.','small')]

    # Página 6: ADR vigente, con alternativas y costo explícito de la tabla técnica.
    story += [PageBreak()]
    story += heading('A3 / DECISIÓN ARQUITECTÓNICA','Comunicación durable de eventos')
    story += [p('<b>ADR-02 · Aceptada e implementada.</b> Reemplaza ADR-01, que conserva la decisión inicial de HTTP posterior al commit. Se mantiene la numeración del repositorio para preservar la trazabilidad del entregable A3.'),
        p('Problema y alternativas','h2'),
        p('Una operación puede confirmar su cambio y caer antes de notificar al log. Los reintentos en memoria no sobreviven al reinicio. La solución debe conservar la notificación de cada cambio confirmado y permitir cambiar su transporte.'),
        table(['Alternativa','Ventaja','Consecuencia principal'],[
            ['HTTP después del commit','Pocas piezas y confirmación directa.','Ventana de pérdida entre commit y publicación; el CRUD espera al receptor.'],
            ['RabbitMQ directo','Mensajes aceptados por el broker pueden persistir y esperar consumidor.','Persisten dos escrituras sin coordinación atómica entre PostgreSQL y broker; agrega operación de colas.'],
            ['Outbox + polling + HTTP','Cambio y pendiente comparten commit; recuperación de entregas tras reiniciar.','Tabla técnica adicional, publicador y entrega eventual; requiere deduplicación.'],
        ],[116,163,WIDTH-279]),
        p('Decisión y mecanismo','h2'),
        p('Adoptar outbox transaccional. BusinessRepository.transaction entrega repositorio y EventPublisher sobre la misma conexión. PgOutboxPublisher guarda el evento. Un proceso PM2 fork toma un pendiente con FOR UPDATE SKIP LOCKED, envía por HTTP con timeout de 1.500 ms y marca delivered_at después de recibir 204.'),
        p('Si falla la entrega, conserva eventId y registra attempts, last_error y next_attempt_at. Reintenta sin límite, con espera exponencial de 1 a 60 s y polling de 500 ms. Si cae tras la persistencia del receptor, el siguiente intento se deduplica por eventId. El log utiliza SQLite con WAL y synchronous=FULL.'),
        callout('Decisión explícita sobre persistencia','Se conservan tres entidades del dominio en public y se agrega una cuarta tabla física técnica: integration.outbox, en la misma base para compartir el commit. Esta es una interpretación documentada del equipo; no se presenta como una aprobación adicional del docente. El log final sigue independiente.'),
        p('Atributos afectados y límites','h2'),
        p('<b>Confiabilidad y disponibilidad:</b> el pendiente sobrevive al reinicio y el CRUD puede operar con el receptor caído. <b>Performance:</b> un INSERT adicional en escrituras; consultas sin publicación. <b>Modificabilidad e integrabilidad:</b> transporte detrás de EventPublisher y DTO estable.'),
        p('Entrega al menos una vez, sin orden estricto. Presupone conservar volúmenes, ejecutar el publicador y reparar fallos permanentes. El publicador mantiene un lock durante cada intento acotado, con pool propio de dos conexiones. Se conservan filas entregadas para inspección; no hay retención automática.','small')]

    # Página 7: evidencia obtenida, sin atribuir causalidad a ejecuciones no controladas.
    story += [PageBreak()]
    story += heading('A4 / EVIDENCIA','Rendimiento y recuperación verificados')
    story += [callout('Resultado vigente con outbox activo','500 consultas/s durante 60 s. p95 = <b>25,67 ms</b>. Cero errores HTTP, cero iteraciones descartadas y todos los checks correctos.'),
        p('Condiciones de la medición','h2'),
        table(['Variable','Condición'],[
            ['Equipo / ejecución','AMD Ryzen 5 Microsoft Surface Edition, 6 núcleos / 12 hilos, 16,6 GB RAM decimal; Windows y Docker Desktop. Generador y servicios comparten equipo.'],
            ['Versiones / procesos','Node v24.15.0; k6 v2.2.0; PostgreSQL 17-alpine. Dos workers API, un publicador y un receptor. Pools API: máximo 10 por base y worker; publicador: dos conexiones.'],
            ['Datos / mezcla','20 clientes, 100 vehículos, 10.000 reservas. Aproximadamente 75% consultas propias y 25% globales, variando cliente, estado y offset; límite de 20 filas e intersección temporal.'],
            ['Protocolo k6','21 logins en setup, fuera de la medición. Calentamiento 100/s por 10 s, pausa 2 s y 500/s por 60 s. 300 VUs preasignados, máximo 300. Se filtran métricas phase:steady.'],
        ],[110,WIDTH-110]),
        p('Ensayos conservados','h2'),
        table(['Configuración','p95','Descartes','Resultado'],[
            ['1 worker; clave JWT string','1.179,39 ms','6.627','No cumple'],
            ['1 worker; clave reutilizada','764,45 ms','1.044','No cumple'],
            ['2 workers; 100 VUs iniciales','155,50 ms','114','No cumple'],
            ['2 workers; 300 VUs iniciales','242,75 ms','0','Cumple'],
            ['2 workers + outbox; 300 VUs','25,67 ms','0','Cumple'],
        ],[254,88,75,WIDTH-417]),
        p('El equipo compartido varía entre ejecuciones: la diferencia de p95 no demuestra que outbox acelere lecturas. El último escenario completó 30.001 consultas en steady por el límite de temporización. El promedio global de k6 incluye setup y calentamiento; no representa la tasa estable. No se midió capacidad máxima de escrituras o de vaciado de backlog.','small'),
        p('Pruebas y fallos','h2'),
        p('<b>5</b> pruebas unitarias; <b>9</b> pruebas/subpruebas de integración general; <b>7</b> de durabilidad. Carrera de 12 altas del mismo intervalo: una aceptada y once conflictos, observando ambos workers. La suite durable prueba rollback, caída tras commit, receptor caído, reinicio y caída tras acuse con deduplicación.'),
        p('En una repetición el proceso de pruebas devolvió un fallo genérico sin informar casos; no se identificó la causa. La ejecución TAP y la repetición posterior del comando habitual aprobaron todos los casos. Comprobación final de demo: 12 eventos persistidos, 12 entregados y cero pendientes.','small'),
        p('Evidencia: results/public/20261028-200851-2-workers.json y metadatos del mismo prefijo. Las copias públicas conservan métricas y checks y excluyen datos de setup con tokens.','small')]

    # Página 8: trazabilidad, limitaciones y referencias del entregable, sin tareas de producción.
    story += [PageBreak()]
    story += heading('A4 / CONSISTENCIA','Trazabilidad y cierre del diseño')
    story += [table(['Requisito','Aplicación en el diseño','Evidencia'],[
            ['RF1','BusinessService: clientes; acceso ADMIN.','CRUD temporal y rechazo CLIENTE.'],
            ['RF2','Vehículos; propietario desde identidad o gestión ADMIN.','CRUD propio, rechazo ajeno y baja referenciada.'],
            ['RF3','Reservas; fechas, propiedad y exclusión PostgreSQL.','Alta, edición, cancelación, contiguos y carrera.'],
            ['RF4','Cliente.identityUserId = JWT.sub.','Consulta propia y rechazo clienteId suministrado.'],
            ['RF5','requireAdmin + filtros por cliente, estado y fechas.','Rechazo CLIENTE y filtros globales.'],
            ['Identidad propia','IdentityService y repositorio separado del negocio.','Login, firma, vigencia y audiencia.'],
            ['Log independiente','Receptor con secreto y storage SQLite.','Persistencia y eventId único.'],
            ['Entrega durable','Commit de negocio + outbox; publicador recuperable.','Rollback, muerte de procesos y reenvío idempotente.'],
            ['Performance','PM2, pools, índices y consulta acotada.','k6: 500/s y p95 25,67 ms.'],
            ['Cambio de transporte','EventPublisher y composición en worker.ts.','Frontera explícita; prueba de contrato prevista al agregar adaptador.'],
        ],[86,220,WIDTH-306]),
        p('Coherencia y alcance','h2'),
        p('El UML muestra los mismos límites usados por las tácticas y por el ADR: identidad separada, negocio transaccional, publicador independiente y log idempotente. El evento pendiente comparte almacenamiento y commit con el negocio; el registro final permanece separado. ADMIN y pertenencia se verifican en servidor.'),
        p('La solución mantiene una UI mínima y comentarios en español sobre reglas y decisiones. Esta entrega no incluye transferencia de propietario, cambio de reservante, renovación/revocación de tokens, borrado de reservas ni un broker. La instalación desde un clon limpio y el recorrido manual completo de formularios quedan como verificaciones de entrega pendientes; las suites funcionales, de durabilidad y de carga descritas sí se ejecutaron.','small'),
        p('Fuentes y material reproducible','h2'),
        p('1. Consigna local: Prueba_Arquitectura_SmartParking_Parte1.pdf y aclaración del docente transmitida por el equipo.<br/>2. Bass, L.; Clements, P.; Kazman, R. <i>Software Architecture in Practice</i>, 4.ª ed.: escenarios de calidad, tácticas e interfaces.<br/>3. <link href="https://www.postgresql.org/docs/17/rangetypes.html" color="#167875">PostgreSQL 17: rangos y exclusión</link>; <link href="https://www.postgresql.org/docs/17/sql-select.html" color="#167875">SELECT y SKIP LOCKED</link>.<br/>4. <link href="https://microservices.io/patterns/data/transactional-outbox" color="#167875">Transactional outbox</link> y <link href="https://microservices.io/patterns/data/polling-publisher.html" color="#167875">Polling publisher</link> (Chris Richardson).<br/>5. <link href="https://pm2.keymetrics.io/docs/usage/cluster-mode/" color="#167875">PM2: cluster mode</link>; <link href="https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/" color="#167875">k6: constant-arrival-rate</link>.','small'),
        p('Repositorio: <link href="https://github.com/odllakoff/smartparking/tree/d86fe22" color="#167875">github.com/odllakoff/smartparking · d86fe22</link>. Fuentes editables: docs/ARQUITECTURA.md, docs/ADR-02.md, docs/componentes.puml y scripts/build-report.py. Pruebas: tests/ y load/queries.js. Instrucciones: README.md.','small')]

    doc.build(story)
    reader=PdfReader(str(OUTPUT))
    if len(reader.pages) != 8:
        raise RuntimeError(f'Se esperaban 8 páginas; se generaron {len(reader.pages)}. Revisar los saltos.')
    print(f'PDF: {OUTPUT}')
    print(f'Páginas: {len(reader.pages)}; figura SVG: {FIGURE}')


if __name__ == '__main__':
    make_report()
