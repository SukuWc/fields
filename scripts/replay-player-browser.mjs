// Browser replay player check (?replay=<id>): start the built server
// (npm run build:app && npm run build:server first), serve a recorded live
// race (test/fixtures/replay-europe-1-mww066n9-1.json) as /api/replays in
// the browser (Playwright route; the server's own list is empty), check the
// landing page links it under europe-1, follow the link, and wait until the
// page has re-simulated the whole race with every hash OK. Not named
// *-check.mjs: npm run check:all (CI) has no built app or browsers.
//
//   node scripts/replay-player-browser.mjs [--engine chromium|firefox|webkit] [--shots dir]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import playwright from 'playwright';

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const engine = arg('engine', 'chromium');
const shots = arg('shots', null);
const record = JSON.parse(readFileSync(new URL('../test/fixtures/replay-europe-1-mww066n9-1.json', import.meta.url), 'utf8'));
// The fixture predates recorded chat: add two lines for the chat panel.
record.chat = [
  { t: 0, seq: 1, at: Date.parse(record.startedAt), sys: true, text: 'Room seed 30' },
  { t: 60, seq: 2, at: Date.parse(record.startedAt) + 2000, text: 'hello from the replay', from: { name: 'suku', boatId: 'b1', n: 0, color: 0xd81b60 } },
];
const bytes = Buffer.byteLength(JSON.stringify(record));
const summary = (({ id, room, startedAt, endedAt, durationS, ticks, players, buildVersion, endReason, seed }) => ({ id, room, startedAt, endedAt, durationS, ticks, players, buildVersion, endReason, seed, bytes }))(record);

const port = 8700 + Math.floor(Math.random() * 200);
const srv = spawn(process.execPath, ['dist-server/server.mjs', '--port', String(port), '--static', 'dist-app'], { stdio: ['ignore', 'pipe', 'inherit'] });
let browser = null;
const fail = async (msg) => { console.error('FAIL ' + msg); if (browser) await browser.close().catch(() => {}); srv.kill(); process.exit(1); };
setTimeout(() => fail('timeout'), 240000).unref();
await new Promise((resolve) => srv.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); }));
const base = `http://127.0.0.1:${port}`;

browser = await playwright[engine].launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.route('**/api/replays', (r) => r.fulfill({ json: [summary] }));
await page.route('**/api/replays/*', (r) => (r.request().url().endsWith('/' + record.id) ? r.fulfill({ json: record }) : r.fulfill({ status: 404, json: { error: 'not found' } })));

await page.goto(base + '/');
const link = page.locator('li.room[data-id="europe-1"] .replays a.replay');
await link.first().waitFor({ timeout: 15000 }).catch(() => fail('no replay link on the landing page'));
const text = await link.first().textContent();
const href = await link.first().getAttribute('href');
console.log('landing link:', JSON.stringify(text), href);
if (!/ · 1:06 · [\d,]+ B · /.test(text)) await fail('landing link without length and size: ' + text);
if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, 'landing.png'), fullPage: true }); }
await link.first().click();
await page.waitForSelector('#replay_banner', { timeout: 15000 });
const t0 = Date.now();
await page.waitForFunction(() => {
  const b = document.getElementById('replay_banner');
  return b && b.dataset.state === 'playing' && window.__simHost && window.__simHost.stepper && window.__simHost.stepper.t > 300;
}, null, { timeout: 60000 }).catch(() => {});
if (shots) await page.screenshot({ path: join(shots, 'replay-playing.png') });
console.log('mid-race:', await page.textContent('#replay_status'));
const chatLog = await page.textContent('#chat_log');
console.log('chat:', JSON.stringify(chatLog));
if (!/hello from the replay/.test(chatLog) || !/Room seed 30/.test(chatLog)) await fail('recorded chat not shown');
if (!(await page.isDisabled('#chat_input'))) await fail('chat input enabled in a replay');
await page.waitForFunction(() => {
  const b = document.getElementById('replay_banner');
  return b && b.dataset.state !== 'playing';
}, null, { timeout: 200000, polling: 500 });
const state = await page.getAttribute('#replay_banner', 'data-state');
const status = await page.textContent('#replay_status');
if (shots) await page.screenshot({ path: join(shots, 'replay-done.png') });
console.log(`end (${((Date.now() - t0) / 1000).toFixed(0)} s wall):`, state, status);
await browser.close();
srv.kill();
if (state !== 'done' || !/hashes OK/.test(status)) await fail('replay did not finish with all hashes OK');
console.log('replay player check passed (' + engine + ')');
process.exit(0);
