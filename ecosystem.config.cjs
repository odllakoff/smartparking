require('dotenv').config();
module.exports = {
  apps: [
    {
      name: 'smartparking-audit', script: 'dist/audit/main.js', instances: 1,
      exec_mode: 'fork', cwd: __dirname, time: true,
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'smartparking-api', script: 'dist/main.js',
      instances: Number(process.env.PM2_INSTANCES || 2), exec_mode: 'cluster',
      cwd: __dirname, time: true, wait_ready: true, listen_timeout: 15000,
      kill_timeout: 10000, env: { NODE_ENV: 'production' }
    }
  ]
};
