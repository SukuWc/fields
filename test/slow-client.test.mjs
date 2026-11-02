// A client that reads its socket fast but processes each message slowly (a
// phone's main thread) must not fall further and further behind: with acks
// the server throttles it, so its lag stays bounded.
import { execFileSync } from 'node:child_process';
const run = (env) => execFileSync(process.execPath, ['--import', './test/register.mjs', 'scripts/slow-client-lag.mjs'],
  { env: { ...process.env, DUR_S: '6', COST_MS: '45', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const lags = (out) => [...out.matchAll(/last=(-?\d+)/g)].map((x) => +x[1]);
const withAck = lags(run({ ACK: '1' }));
const ok = withAck.length >= 2 && Math.max(...withAck.slice(1)) <= 30;
console.log(`slow client lag with ack: ${withAck.join(',')} ticks`);
if (!ok) { console.log('slow-client FAILED: lag not bounded'); process.exit(1); }
console.log('all slow-client checks passed');
process.exit(0);
