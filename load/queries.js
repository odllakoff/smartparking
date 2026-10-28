import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';
const workers = new Counter('worker_requests');
const base = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const duration = __ENV.DURATION || '60s';
export const options = {
  scenarios: {
    warmup: { executor:'constant-arrival-rate',rate:100,timeUnit:'1s',duration:'10s',preAllocatedVUs:30,maxVUs:100,tags:{ phase:'warmup' } },
    // Se reservan los VUs antes de medir: crearlos bajo carga puede descartar iteraciones.
    steady: { executor:'constant-arrival-rate',rate:Number(__ENV.RATE || 500),timeUnit:'1s',duration,startTime:'12s',preAllocatedVUs:300,maxVUs:300,tags:{ phase:'steady' } }
  },
  thresholds: {
    'http_req_duration{phase:steady}':['p(95)<300'],
    'http_req_failed{phase:steady}':['rate==0'],
    'checks{phase:steady}':['rate==1'],
    'dropped_iterations{scenario:steady}':['count==0']
  }
};
export function setup() {
  const accounts = ['admin@demo.local',...Array.from({ length:20 },(_,i) => `cliente${i+1}@demo.local`)];
  const sessions = accounts.map(email => {
    const r = http.post(base+'/api/auth/login',JSON.stringify({ email,password:__ENV.DEMO_PASSWORD }),{ headers:{ 'Content-Type':'application/json' } });
    if (r.status !== 200) fail('No se pudo autenticar '+email);
    const token = r.json('accessToken');
    const user = http.get(base+'/api/auth/me',{ headers:{ Authorization:'Bearer '+token } });
    if (user.status !== 200) fail('No se pudo obtener la identidad');
    const profile = user.json();
    return { token,clienteId:profile.cliente ? profile.cliente.id : null };
  });
  return sessions;
}
export default function(sessions) {
  const index = (__ITER + __VU) % 20 + 1;
  const global = (__ITER + __VU) % 4 === 0;
  const session = global ? sessions[0] : sessions[index];
  const filter = `estado=${__ITER % 2 ? 'ACTIVA' : 'CANCELADA'}&desde=2030-01-01T00%3A00%3A00Z&hasta=2030-01-10T00%3A00%3A00Z&limit=20&offset=${(__ITER % 4)*20}`;
  const url = global ? `/api/admin/reservas?clienteId=${sessions[index].clienteId}&${filter}` : `/api/reservas?${filter}`;
  const r = http.get(base+url,{ headers:{ Authorization:'Bearer '+session.token },tags:{ name:global ? 'reservas_globales' : 'reservas_propias' } });
  check(r,{ 'consulta exitosa':r => r.status===200,'respuesta de reservas':r => { try { return Array.isArray(r.json()); } catch { return false; } } });
  workers.add(1,{ pid:r.headers['X-Worker-Pid'] || 'desconocido' });
}
