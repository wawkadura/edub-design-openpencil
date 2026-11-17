// PM2 (user edub) — Edub Design. `pm2 start edub/deploy/ecosystem.config.cjs`
const root = '/home/edub/apps/edub-design';
module.exports = {
  apps: [
    {
      name: 'edub-design-editor',
      cwd: `${root}/dist`,
      script: './op-host-web-server',
      args: '--serve-web 3100 --host 127.0.0.1',
      autorestart: true,
      max_memory_restart: '1500M',
    },
    {
      // Le portail arrive avec le ticket « portail » (edub/portal). Tant qu'il n'existe pas : 502 attendu.
      name: 'edub-design-portal',
      cwd: `${root}/edub/portal`,
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3038 -H 127.0.0.1',
      env: { NODE_ENV: 'production', PORT: '3038' },
      autorestart: true,
    },
  ],
};
