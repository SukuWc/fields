// Build what the Node server serves (apps/server --static dist-app):
//   dist-app/index.html   landing page (apps/landing)
//   dist-app/play/        the game, connecting to the same origin's WebSocket
//   dist-app/version.json { commit } short SHA baked in at build time
// The GitHub Pages build (npm run build -> dist/) is unchanged.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

function shortCommit() {
  // Coolify passes SOURCE_COMMIT as a Docker build-arg; COMMIT_SHA / GIT_COMMIT
  // are fallbacks (CI or a manual build-arg). Skip the literal "dev".
  for (const key of ['SOURCE_COMMIT', 'COMMIT_SHA', 'GIT_COMMIT']) {
    const v = (process.env[key] || '').trim();
    if (!v || v === 'dev') continue;
    return v.replace(/^[^0-9a-f]*/i, '').slice(0, 7) || v.slice(0, 7);
  }
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

const commit = shortCommit();
fs.rmSync('dist-app', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-app/play', '--emptyOutDir', '--logLevel', 'warn'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE_PATH: '/play/', VITE_SIM_HOST: 'remote', VITE_SIM_SERVER_URL: 'same-origin' },
});
let landing = fs.readFileSync('apps/landing/index.html', 'utf8');
if (!landing.includes('__BUILD_COMMIT__')) throw new Error('apps/landing/index.html missing __BUILD_COMMIT__ placeholder');
landing = landing.split('__BUILD_COMMIT__').join(commit);
fs.writeFileSync('dist-app/index.html', landing);
fs.writeFileSync('dist-app/version.json', JSON.stringify({ commit }) + '\n');
for (const f of ['sailzone-logo.svg', 'sailzone-icon.svg']) fs.copyFileSync('assets/' + f, 'dist-app/' + f);
console.log('built dist-app/ (landing at /, game at /play/, commit ' + commit + ')');
