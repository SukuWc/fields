// Browser regression: randomized seek / pause / play on a replay, assert
// every hash check passes.
//   node scripts/replay-seek-fuzz.mjs [--engine chromium|firefox] [--record path] [--seed 1] [--ops 24] [--speed 0|1|2|4] [--play-to N] [--seeks 2000,400]
// --speed 0 (default) mixes 1/2/4 during the loop. 1, 2 or 4 holds that speed.
// --play-to N plays (no seeks) until tick N, then exits unless --ops/--seeks is also set.
// --seeks a,b,c seeks to those ticks in order (works while playing; waits until the landing is seen).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import playwright from 'playwright';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const engine = arg('engine', 'firefox');
const seed = Number(arg('seed', '1')) >>> 0;
const playTo = Number(arg('play-to', '0'));
const seeks = (arg('seeks', '') || '').split(',').map((x) => Number(x)).filter((n) => Number.isFinite(n));
const ops = Number(arg('ops', (playTo > 0 || seeks.length) ? '0' : '24'));
const speed = Number(arg('speed', '0')); // 0: mix 1/2/4
const record = JSON.parse(readFileSync(arg('record', new URL('../test/fixtures/replay-europe-1-mwxq7pem-1.json', import.meta.url).pathname), 'utf8'));

let a = seed || 1;
const rnd = () => {
  a = (a + 0x6D2B79F5) >>> 0;
  let x = a;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

const port = 9400 + Math.floor(Math.random() * 80);
const srv = spawn(process.execPath, ['dist-server/server.mjs', '--port', String(port), '--static', 'dist-app'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('server')), 15000);
  srv.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(); } });
});
const summary = { id: record.id, room: record.room, startedAt: record.startedAt, endedAt: record.endedAt, durationS: record.durationS, ticks: record.ticks, players: record.players, buildVersion: record.buildVersion, endReason: record.endReason, seed: record.seed, bytes: Buffer.byteLength(JSON.stringify(record)) };
const browser = await playwright[engine].launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.route('**/api/replays', (r) => r.fulfill({ json: [summary] }));
await page.route('**/api/replays/*', (r) => (r.request().url().endsWith('/' + record.id) ? r.fulfill({ json: record }) : r.fulfill({ status: 404, json: { error: 'not found' } })));
await page.goto(`http://127.0.0.1:${port}/play/?replay=${record.id}`);
await page.waitForFunction(() => window.__simHost && window.__simHost.status && window.__simHost.status().t > 5, null, { timeout: 60000 });

const st = () => page.evaluate(() => {
  const s = window.__simHost.status();
  return { t: s.t, mismatch: s.mismatch, seeking: s.seeking, paused: s.paused, checked: s.checked, lastSeekMs: s.lastSeekMs, simulatedTo: s.simulatedTo };
});
const seekTo = async (t) => {
  const t0 = Date.now();
  // Playback at 2x/4x can leave the landing tick in a few ms, so watch
  // status until we actually see t near the target. Do not treat "done"
  // as success: a missed seek would otherwise play out to the end.
  await page.evaluate((x) => {
    window.__seekWant = x;
    window.__sawSeekLand = false;
    if (!window.__seekWatching) {
      window.__seekWatching = true;
      window.__simHost.onStatus((s) => {
        if (s && Math.abs(s.t - window.__seekWant) <= 2) window.__sawSeekLand = true;
      });
    }
    window.__simHost.seek(x);
  }, t);
  await page.waitForFunction(() => {
    const s = window.__simHost.status();
    return !!(s && (s.mismatch || (window.__sawSeekLand && !s.seeking)));
  }, null, { timeout: 180000, polling: 25 });
  return { wall: Date.now() - t0, ...(await st()), want: t, landed: await page.evaluate(() => window.__sawSeekLand) };
};

const fail = async (extra) => {
  console.log('RESULT', { engine, ok: false, lastSeekMs, ...extra });
  await browser.close();
  srv.kill();
  process.exit(2);
};

const cap = Math.min(record.ticks, 2500);
console.log('setup', { engine, seed, ops, speed, playTo, seeks, id: record.id, ticks: record.ticks, cap });
if (speed === 1 || speed === 2 || speed === 4) await page.evaluate((n) => window.__simHost.setSpeed(n), speed);

let lastSeekMs = null;
if (playTo > 0) {
  await page.evaluate(() => window.__simHost.setPaused(false));
  const t0 = Date.now();
  await page.waitForFunction((x) => {
    const s = window.__simHost.status();
    return s.mismatch || s.done || s.t >= x;
  }, playTo, { timeout: 180000, polling: 25 });
  const played = await st();
  console.log('play-to', { want: playTo, wall: Date.now() - t0, ...played });
  if (played.mismatch) await fail({ mismatch: played.mismatch });
}

for (let i = 0; i < seeks.length; i++) {
  const res = await seekTo(seeks[i]);
  lastSeekMs = res.lastSeekMs;
  console.log('seek', i, res);
  if (res.mismatch || !res.landed) await fail({ mismatch: res.mismatch, landed: res.landed, want: seeks[i] });
}

for (let i = 0; i < ops; i++) {
  const r = rnd();
  if (speed === 0 && r < 0.08) {
    const n = [1, 2, 4][(rnd() * 3) | 0];
    await page.evaluate((s) => window.__simHost.setSpeed(s), n);
    console.log('op', i, 'speed', n);
  } else if (r < 0.35) {
    await page.evaluate(() => window.__simHost.setPaused(false));
    await page.waitForTimeout(250 + (rnd() * 400 | 0));
    await page.evaluate(() => window.__simHost.setPaused(true));
    await page.waitForTimeout(200);
  } else {
    const t = (rnd() * (cap + 1)) | 0;
    const res = await seekTo(t);
    lastSeekMs = res.lastSeekMs;
    console.log('op', i, 'seek', res);
    if (res.mismatch || !res.landed) await fail({ mismatch: res.mismatch, landed: res.landed, want: t });
  }
  const s = await st();
  if (s.mismatch) await fail({ mismatch: s.mismatch });
}
const end = await st();
console.log('RESULT', { engine, ok: !end.mismatch, mismatch: end.mismatch, lastSeekMs, t: end.t, checked: end.checked });
await browser.close();
srv.kill();
if (end.mismatch) process.exit(2);
