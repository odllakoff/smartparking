'use strict';
let token = '', me;
const $ = id => document.getElementById(id);
function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : 'success'; }
async function api(path, method = 'GET', body) {
  const response = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && token) logout();
    throw new Error(result.error + (result.details ? '\n' + JSON.stringify(result.details) : ''));
  }
  return result;
}
function safe(work) { return async event => { if (event) event.preventDefault(); try { await work(event); } catch (error) { message(error.message,true); } }; }
function data(form) { return Object.fromEntries(new FormData(form)); }
function fill(formId, row) {
  const form = $(formId); form.reset();
  for (const [key,value] of Object.entries(row)) {
    const input = form.elements.namedItem(key);
    if (input) input.value = input.type === 'datetime-local' ? localDate(value) : value;
  }
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function localDate(value) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function logout() { token = ''; me = null; $('appPanel').hidden = true; $('loginPanel').hidden = false; $('logout').hidden = true; $('session').textContent = 'Demo educativa'; }
$('logout').onclick = logout;
$('login').onsubmit = safe(async () => {
  const result = await api('/auth/login','POST',data($('login'))); token = result.accessToken;
  me = await api('/auth/me'); $('login').reset(); $('loginPanel').hidden = true; $('appPanel').hidden = false; $('logout').hidden = false;
  $('session').textContent = me.role + (me.cliente ? ' · ' + me.cliente.nombre : '');
  $('clientsTab').hidden = me.role !== 'ADMIN';
  document.querySelectorAll('.adminOnly').forEach(el => el.hidden = me.role !== 'ADMIN');
  $('vehiclesTitle').textContent = me.role === 'ADMIN' ? 'Vehículos' : 'Mis vehículos';
  document.querySelectorAll('.tab').forEach(el => el.hidden = el.id !== 'vehiculos');
  await loadVehicles(); message('Sesión iniciada');
});
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = safe(async () => {
  document.querySelectorAll('.tab').forEach(el => el.hidden = el.id !== button.dataset.tab);
  if (button.dataset.tab === 'vehiculos') await loadVehicles();
  if (button.dataset.tab === 'reservas') { await loadCatalog(); await loadReservations(); }
  if (button.dataset.tab === 'clientes') await loadClients();
}));
// textContent evita interpretar los datos persistidos como HTML.
function table(container, rows, columns, actions) {
  const target = $(container); target.replaceChildren();
  if (!rows.length) { target.textContent = 'No hay registros.'; return; }
  const wrap = document.createElement('div'); wrap.className = 'tableWrap';
  const table = document.createElement('table'), head = document.createElement('tr');
  for (const key of [...columns,'Acciones']) { const th = document.createElement('th'); th.textContent = key; head.append(th); }
  const thead = document.createElement('thead'); thead.append(head); table.append(thead);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const key of columns) { const td = document.createElement('td'); td.textContent = row[key]; tr.append(td); }
    const td = document.createElement('td');
    for (const [label,action] of actions(row)) { const button = document.createElement('button'); button.textContent = label; button.onclick = safe(() => action(row)); td.append(button); }
    tr.append(td); tbody.append(tr);
  }
  table.append(tbody); wrap.append(table); target.append(wrap);
}
const offsets = {};
async function paginated(container, endpoint, columns, actions, reset = false) {
  if (reset) offsets[container] = 0;
  const offset = offsets[container] || 0;
  const rows = await api(endpoint + (endpoint.includes('?') ? '&' : '?') + 'limit=20&offset=' + offset);
  table(container,rows,columns,actions);
  const pager = document.createElement('div'); pager.className = 'pager';
  for (const [label,delta,disabled] of [['Anterior',-20,offset===0],['Siguiente',20,rows.length<20]]) {
    const button = document.createElement('button'); button.textContent = label; button.disabled = disabled;
    button.onclick = safe(async () => { offsets[container] = offset + delta; await paginated(container,endpoint,columns,actions); }); pager.append(button);
  }
  $(container).append(pager);
}
async function loadVehicles() {
  await paginated('vehicleList','/vehiculos',['id','matricula','marca','modelo','clienteId'], () => [
    ['Editar',r => fill('vehicleForm',r)], ['Eliminar',async r => { if (confirm('¿Eliminar vehículo?')) { await api('/vehiculos/'+r.id,'DELETE'); await loadVehicles(); message('Vehículo eliminado'); } }]
  ],true);
}
async function loadCatalog() { await paginated('catalogList','/catalogo',['id','matricula','marca','modelo'], () => [['Elegir',r => { $('reservationForm').reset(); $('reservationForm').elements.vehiculoId.value = r.id; }]],true); }
async function loadReservations() {
  const input = data($('filterForm')), query = new URLSearchParams();
  for (const [key,value] of Object.entries(input)) if (value && (key !== 'clienteId' || me.role === 'ADMIN')) query.set(key, key === 'desde' || key === 'hasta' ? new Date(value).toISOString() : value);
  await paginated('reservationList',(me.role === 'ADMIN' ? '/admin/reservas?' : '/reservas?') + query,['id','clienteId','vehiculoId','inicio','fin','estado'], r => r.estado === 'ACTIVA' ? [
    ['Editar',row => fill('reservationForm',row)], ['Cancelar',async row => { if (confirm('¿Cancelar reserva?')) { await api('/reservas/'+row.id+'/cancelar','POST'); await loadReservations(); message('Reserva cancelada'); } }]
  ] : [],true);
}
async function loadClients() { await paginated('clientList','/clientes',['id','nombre','email','telefono','identityUserId'], () => [
  ['Editar',r => fill('clientForm',r)],['Eliminar',async r => { if (confirm('¿Eliminar cliente?')) { await api('/clientes/'+r.id,'DELETE'); await loadClients(); message('Cliente eliminado'); } }]
],true); }
$('vehicleForm').onsubmit = safe(async () => {
  const { id,clienteId,...input } = data($('vehicleForm'));
  if (!id && me.role === 'ADMIN') input.clienteId = clienteId;
  await api('/vehiculos'+(id ? '/'+id : ''),id ? 'PUT' : 'POST',input); $('vehicleForm').reset(); await loadVehicles(); message('Vehículo guardado');
});
$('reservationForm').onsubmit = safe(async () => {
  const { id,clienteId,vehiculoId,inicio,fin } = data($('reservationForm'));
  const input = { inicio: new Date(inicio).toISOString(),fin: new Date(fin).toISOString() };
  if (!id) { input.vehiculoId = vehiculoId; if (me.role === 'ADMIN') input.clienteId = clienteId; }
  await api('/reservas'+(id ? '/'+id : ''),id ? 'PUT' : 'POST',input); $('reservationForm').reset(); await loadReservations(); message('Reserva guardada');
});
$('userForm').onsubmit = safe(async () => {
  const input = data($('userForm')); const user = await api('/auth/users','POST',input);
  $('clientForm').elements.identityUserId.value = user.id; $('clientForm').elements.email.value = user.email;
  $('userForm').reset(); message('Identidad creada. Complete el cliente usando el identificador copiado al formulario.');
});
$('clientForm').onsubmit = safe(async () => {
  const { id,identityUserId,...input } = data($('clientForm')); if (!id) input.identityUserId = identityUserId;
  await api('/clientes'+(id ? '/'+id : ''),id ? 'PUT' : 'POST',input); $('clientForm').reset(); await loadClients(); message('Cliente guardado');
});
$('filterForm').onsubmit = safe(loadReservations);
$('refreshVehicles').onclick = safe(loadVehicles); $('refreshCatalog').onclick = safe(loadCatalog); $('refreshClients').onclick = safe(loadClients);
