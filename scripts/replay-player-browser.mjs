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
  return b && b.dataset.state === 'playing' && window.__simHost && window.__simHost.status && window.__simHost.status().t > 300;
}, null, { timeout: 60000 }).catch(() => {});
if (shots) await page.screenshot({ path: join(shots, 'replay-playing.png') });
console.log('mid-race:', await page.textContent('#replay_status'));
const chatLog = await page.textContent('#chat_log');
console.log('chat:', JSON.stringify(chatLog));
if (!/hello from the replay/.test(chatLog) || !/Room seed 30/.test(chatLog)) await fail('recorded chat not shown');
if (!(await page.isDisabled('#chat_input'))) await fail('chat input enabled in a replay');
// Seeking through the timeline (src/replay-banner.js; src/replay-engine.js in
// the replay worker), paused: click the scrub bar near 50 s, then set it to
// 15 s; each lands on its tick with the hashes still OK and the chat history
// cut to the new position. Then 4x speed to the end.
const seekTo = async (t, how) => {
  const s0 = Date.now();
  const before = await page.evaluate(() => window.__simHost.status());
  console.log(`before seek to ${t}: at ${before.t}, look-ahead simulated to ${before.simulatedTo}, keyframes ${before.keyframes.join(',')}`);
  if (how === 'click') {
    const box = await page.locator('#replay_timeline').boundingBox();
    // A range input maps x to value over its width less the (invisible) thumb: aim, then read it back.
    await page.mouse.click(box.x + (box.width * t) / before.ticks, box.y + box.height / 2);
  } else await page.locator('#replay_scrub').fill(String(t));
  const target = await page.evaluate(() => Number(document.getElementById('replay_scrub').value));
  await page.waitForFunction(() => document.getElementById('replay_banner').dataset.state === 'seeking', null, { timeout: 5000, polling: 20 }).then(async () => {
    if (shots && how === 'click') await page.screenshot({ path: join(shots, 'replay-seeking.png') });
    console.log('while seeking:', await page.textContent('#replay_seek_text'));
  }, () => {});
  await page.waitForFunction((x) => { const st = window.__simHost.status(); return st.t === x && !st.seeking; }, target, { timeout: 120000, polling: 50 });
  const st = await page.evaluate(() => window.__simHost.status());
  console.log(`seek to ${target}: ${Date.now() - s0} ms wall (worker ${st.lastSeekMs} ms), keyframes ${st.keyframes.join(',')}, simulated to ${st.simulatedTo}; timeline ${await page.textContent('#replay_time')} / ${await page.textContent('#replay_total')}`);
  if (st.mismatch) await fail('mismatch after a seek: ' + JSON.stringify(st.mismatch));
  return target;
};
await page.click('#replay_pause');
await page.waitForFunction(() => document.getElementById('replay_banner').dataset.state === 'paused', null, { timeout: 5000 }).catch(() => fail('Pause did not pause'));
await seekTo(1500, 'click');
const chatFwd = await page.textContent('#chat_log');
if (!/hello from the replay/.test(chatFwd)) await fail('chat history lost after seeking forward');
if (shots) await page.screenshot({ path: join(shots, 'replay-after-seek.png') });
await seekTo(450, 'fill');
const chatAfter = await page.textContent('#chat_log');
if (!/hello from the replay/.test(chatAfter)) await fail('chat history lost after seeking back');
await seekTo(30, 'fill');
const chatEarly = await page.textContent('#chat_log');
console.log('chat at 0:01:', JSON.stringify(chatEarly));
if (/hello from the replay/.test(chatEarly) || !/Room seed 30/.test(chatEarly)) await fail('chat does not follow a seek back before its line');
await page.click('#replay_speed button[data-speed="4"]');
await page.click('#replay_pause');
const s4 = await page.evaluate(() => window.__simHost.status().t);
const w4 = Date.now();
await page.waitForTimeout(3000);
const st4 = await page.evaluate(() => window.__simHost.status());
console.log(`4x: ${((st4.t - s4) / ((Date.now() - w4) / 1000) / 30).toFixed(2)} race s per s (speed ${st4.speed})`);
if (shots) await page.screenshot({ path: join(shots, 'replay-4x.png') });
await page.waitForFunction(() => {
  const b = document.getElementById('replay_banner');
  return b && ['done', 'mismatch', 'error'].includes(b.dataset.state);
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
