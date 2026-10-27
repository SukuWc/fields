// Build what the Node server serves (apps/server --static dist-app):
//   dist-app/index.html   landing page (apps/landing)
//   dist-app/play/        the game, connecting to the same origin's WebSocket
//   dist-app/version.json { commit, url } baked in at build time
// The GitHub Pages build (npm run build -> dist/) is unchanged.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import esbuild from 'esbuild';

const REPO_COMMIT = 'https://github.com/SukuWc/fields/commit/';

// Coolify passes SOURCE_COMMIT as a Docker build-arg; COMMIT_SHA / GIT_COMMIT
// are fallbacks. Returns { commit: short, sha: fullOrShort, url } or { commit: 'dev' }.
function resolveCommit() {
  for (const key of ['SOURCE_COMMIT', 'COMMIT_SHA', 'GIT_COMMIT']) {
    const v = (process.env[key] || '').trim();
    if (!v || v === 'dev') continue;
    const hex = v.replace(/^[^0-9a-f]*/i, '') || v;
    if (!/^[0-9a-f]+$/i.test(hex)) continue;
    const sha = hex.length >= 40 ? hex.slice(0, 40) : hex;
    const commit = sha.slice(0, 7);
    return { commit, sha, url: REPO_COMMIT + sha };
  }
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    return { commit, sha, url: REPO_COMMIT + sha };
  } catch {
    return { commit: 'dev' };
  }
}

const version = resolveCommit();
fs.rmSync('dist-app', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'dist-app/play', '--emptyOutDir', '--logLevel', 'warn'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE_PATH: '/play/', VITE_SIM_HOST: 'remote', VITE_SIM_SERVER_URL: 'same-origin' },
});
let landing = fs.readFileSync('apps/landing/index.html', 'utf8');
if (!landing.includes('__BUILD_FOOTER__')) throw new Error('apps/landing/index.html missing __BUILD_FOOTER__ placeholder');
const footer = version.url
  ? `build <a href="${version.url}">${version.commit}</a>`
  : `build ${version.commit}`;
landing = landing.split('__BUILD_FOOTER__').join(footer);
fs.writeFileSync('dist-app/index.html', landing);
// Use the JS API — node_modules/esbuild/bin/esbuild is a native ELF binary on
// Linux (Docker/Coolify), so `node …/bin/esbuild` throws SyntaxError: Invalid
// or unexpected token. Vite still uses process.execPath because vite.js is JS.
esbuild.buildSync({
  entryPoints: ['apps/landing/perf-charts.js'],
  bundle: true,
  format: 'iife',
  outfile: 'dist-app/perf-charts.js',
  logLevel: 'warning',
});

fs.writeFileSync('dist-app/version.json', JSON.stringify(version) + '\n');
for (const f of ['sailzone-logo.svg', 'sailzone-icon.svg']) fs.copyFileSync('assets/' + f, 'dist-app/' + f);
console.log('built dist-app/ (landing at /, game at /play/, commit ' + version.commit + ')');
