// A remote client whose socket is read off the main thread (like a browser)
// but whose per-frame decode + render is slower than the 30 Hz frame rate
// must not fall behind: RemoteHost parks only the newest raw frame and
// decodes it once per animation frame (scripts/slow-client-lag.mjs).
import { execFileSync } from 'node:child_process';
const t0 = Date.now();
const out = execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/slow-client-lag.mjs'],
  { env: { ...process.env, DUR_S: '6', DECODE_MS: '40', RENDER_MS: '15' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const wall = (Date.now() - t0) / 1000;
const rows = [...out.matchAll(/last=(-?\d+) rendered=(\d+)/g)].map((x) => ({ lag: +x[1], rendered: +x[2] }));
console.log(out.trim());
const ok = rows.length >= 3 && rows.every((r) => r.lag <= 5) && rows.at(-1).rendered >= 60 && wall < 20;
if (!ok) { console.log('slow-client FAILED: lag not bounded (wall ' + wall.toFixed(1) + ' s)'); process.exit(1); }
console.log('all slow-client checks passed');
process.exit(0);
