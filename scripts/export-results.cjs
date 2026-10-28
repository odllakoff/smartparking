const fs = require('node:fs');
const path = require('node:path');

// k6 incluye setup_data (con los JWT del login) al exportar el resumen original.
// Publicamos solamente métricas y checks; los originales permanecen ignorados por Git.
const source = path.resolve('results');
const target = path.join(source, 'public');
fs.mkdirSync(target, { recursive: true });
for (const filename of fs.readdirSync(source).filter(name => /^\d{8}-\d{6}-\d+-workers(?:-environment)?\.json$/.test(name))) {
  const raw = JSON.parse(fs.readFileSync(path.join(source, filename), 'utf8'));
  const keys = filename.endsWith('-environment.json')
    ? ['timestamp', 'workers', 'duration', 'rate', 'node', 'k6', 'cpu', 'ramBytes', 'steadyPreAllocatedVUs', 'steadyMaxVUs', 'loadScriptSha256']
    : ['metrics', 'root_group'];
  const clean = Object.fromEntries(keys.filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]]));
  const text = JSON.stringify(clean, null, 2) + '\n';
  if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text)) {
    throw new Error(`Se detectó un JWT en ${filename}; no se exportará`);
  }
  fs.writeFileSync(path.join(target, filename), text);
  console.log(`Exportado sin datos de sesión: ${filename}`);
}
