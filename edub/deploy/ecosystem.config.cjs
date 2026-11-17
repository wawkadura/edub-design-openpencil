// PM2 (user edub) — Edub Design. First start: `pm2 start edub/deploy/ecosystem.config.cjs && pm2 save`.
// Day to day: `bash edub/scripts/deploy.sh` (never edit the live clone by hand).
const fs = require('fs');
const root = '/home/edub/apps/edub-design';
const secrets = '/home/edub/.config/edub-design';

// Blue/green Next build dir chosen by deploy.sh (re-read on `pm2 reload --update-env`).
let portalDist = '.next-a';
try {
  portalDist = fs.readFileSync(`${root}/edub/portal/.next-active`, 'utf8').trim() || portalDist;
} catch {}

module.exports = {
  apps: [
    {
      // OpenPencil web host in public multi-tenant mode. Loopback only; reached through
      // nginx, which gates every /api call via the portal (one tenant = one design file).
      name: 'edub-design-editor',
      cwd: `${root}/dist`,
      script: './op-host-web-server',
      args: '--serve-web 3100 --host 127.0.0.1 --online',
      env: {
        OPENPENCIL_HUB_BASE_URL: 'http://127.0.0.1:3038',
        OPENPENCIL_HUB_INTERNAL_AUTH_FILE: `${secrets}/hub-internal-auth`,
        OPENPENCIL_ONLINE_DATA_DIR: `${root}/data/editor`,
        OPENPENCIL_WEB_ALLOWED_ORIGINS: 'https://design.edub.fr',
      },
      kill_timeout: 15000,
      autorestart: true,
      max_memory_restart: '1500M',
    },
    {
      name: 'edub-design-portal',
      cwd: `${root}/edub/portal`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3038 -H 127.0.0.1',
      env: { NODE_ENV: 'production', PORT: '3038', EDUB_NEXT_DIST_DIR: portalDist },
      autorestart: true,
      max_memory_restart: '600M',
    },
  ],
};
