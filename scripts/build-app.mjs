// Build what the Node server serves (apps/server --static dist-app):
//   dist-app/index.html   landing page (apps/landing)
//   dist-app/play/        the game, connecting to the same origin's WebSocket
// The GitHub Pages build (npm run build -> dist/) is unchanged.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

fs.rmSync('dist-app', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-app/play', '--emptyOutDir', '--logLevel', 'warn'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE_PATH: '/play/', VITE_SIM_HOST: 'remote', VITE_SIM_SERVER_URL: 'same-origin' },
});
fs.copyFileSync('apps/landing/index.html', 'dist-app/index.html');
for (const f of ['sailzone-logo.svg', 'sailzone-icon.svg']) fs.copyFileSync('assets/' + f, 'dist-app/' + f);
console.log('built dist-app/ (landing at /, game at /play/)');
