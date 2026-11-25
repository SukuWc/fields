// Replay determinism, milestone 2 (docs/replay-determinism.md): run the
// harness in Node and in Chromium, Firefox and WebKit (Playwright; WebKit
// stands in for iOS Safari / JavaScriptCore) and compare every tick's state
// hash against Node.
//
//   npx playwright install chromium firefox webkit   (once)
//   npm run determinism:browsers -- [--ticks 18000] [--every 1] [--engines chromium,firefox,webkit] [--out dir]
//   npm run determinism:browsers -- --restore [--record file] [--at 1,450,1200,1500] [--after 90] [--engines ...]
//
// --restore: snapshot / restore (src/sim-snapshot.js) instead. Each engine
// replays a recorded race (default: the live race in test/fixtures), takes a
// snapshot at each --at tick, then restores every snapshot and steps on
// --after ticks (0 = to the end), checking each recorded hash; exits 1 on any
// mismatch.
//
// 18000 ticks = 10 simulated minutes at 30 Hz. Engines run in parallel.
// Writes <out>/<engine>.json (default out: $TMPDIR/fields-determinism) (hashes) and <out>/summary.json, prints a table,
// exits 1 if any engine diverges from Node.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { firstDivergence } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const ticks = Number(arg('ticks', 18000));
const every = Number(arg('every', 1));
const engines = String(arg('engines', 'chromium,firefox,webkit')).split(',').filter(Boolean);
const outDir = arg('out', join(tmpdir(), 'fields-determinism'));
const CHUNK = 300;
mkdirSync(outDir, { recursive: true });

function runNode() {
  const out = join(outDir, 'node.json');
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--import', './test/register.mjs', 'scripts/determinism/node-run.mjs', '--ticks', String(ticks), '--every', String(every), '--out', out], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => { const s = String(d).trim(); if (/^node \d/.test(s)) console.log(s.split('\n').pop()); });
    p.on('exit', (code) => (code === 0 ? resolve(JSON.parse(readFileSync(out, 'utf8'))) : reject(new Error('node run exited ' + code))));
  });
}

async function runBrowser(name, bundle) {
  const pw = await import('playwright');
  const browser = await pw[name].launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('about:blank');
    await page.addScriptTag({ content: bundle });
    if (errors.length) throw new Error(name + ': ' + errors.join('; '));
    await page.evaluate((o) => window.__determinism.start(o), { ticks, every });
    let t = 0;
    while (t < ticks) {
      t = await page.evaluate((n) => window.__determinism.step(n), CHUNK);
      if (t % 1800 === 0 || t === ticks) console.log(`${name} ${t}/${ticks}`);
    }
    const res = await page.evaluate(() => window.__determinism.result());
    const ua = await page.evaluate(() => navigator.userAgent);
    const out = { engine: name, version: browser.version(), userAgent: ua, ...res };
    writeFileSync(join(outDir, name + '.json'), JSON.stringify(out));
    return out;
  } finally {
    await browser.close();
  }
}

if (process.argv.includes('--restore')) {
  const recordFile = arg('record', join(root, 'test', 'fixtures', 'replay-europe-1-mww066n9-1.json'));
  const record = JSON.parse(readFileSync(recordFile, 'utf8'));
  const at = String(arg('at', '1,450,1200,1500')).split(',').map(Number);
  const after = Number(arg('after', 90));
  const entry = await build({
    entryPoints: [join(here, 'restore-entry.mjs')],
    bundle: true, format: 'iife', write: false, platform: 'browser', target: 'es2020', logLevel: 'warning',
  });
  const code = entry.outputFiles[0].text;
  const rows = [];
  for (const name of engines) {
    const pw = await import('playwright');
    const browser = await pw[name].launch();
    try {
      const page = await browser.newPage();
      await page.goto('about:blank');
      await page.addScriptTag({ content: code });
      await page.evaluate((o) => window.__restore.start(o.record, o.at, o.after), { record, at, after });
      while ((await page.evaluate(() => window.__restore.step())) !== -1) { /* chunks of 300 ticks */ }
      const res = await page.evaluate(() => window.__restore.result());
      rows.push({ engine: name, version: browser.version(), msPerTick: Math.round(res.full.msPerTick * 100) / 100, full: res.full.firstMismatch ? 'MISMATCH ' + res.full.firstMismatch.t : 'OK ' + res.full.finalHash });
      for (const r of res.restores) rows.push({ engine: name, restoreAt: r.t, snapshotMs: r.snapshotMs, restoreMs: r.restoreMs, hashesChecked: r.checked, result: r.firstMismatch ? 'MISMATCH ' + r.firstMismatch.t : 'OK' + (r.finalHash ? ' ' + r.finalHash : '') });
    } finally {
      await browser.close();
    }
  }
  writeFileSync(join(outDir, 'restore-summary.json'), JSON.stringify(rows, null, 2));
  console.table(rows);
  process.exit(rows.some((r) => String(r.result || r.full).startsWith('MISMATCH')) ? 1 : 0);
}

const bundled = await build({
  entryPoints: [join(here, 'browser-entry.mjs')],
  bundle: true, format: 'iife', write: false, platform: 'browser', target: 'es2020', logLevel: 'warning',
});
const bundle = bundled.outputFiles[0].text;

const t0 = Date.now();
const results = await Promise.all([runNode(), ...engines.map((e) => runBrowser(e, bundle))]);
const ref = results[0];
const summary = {
  ticks, every, simulatedSeconds: ticks / 30, wallSeconds: Math.round((Date.now() - t0) / 1000),
  engines: results.map((r) => {
    const d = r === ref ? null : firstDivergence(ref.hashes, r.hashes);
    return {
      engine: r.engine, version: r.engine === 'node' ? `${r.version} (V8 ${r.v8})` : r.version,
      msPerTick: Math.round(r.msPerTick * 100) / 100,
      finalHash: r.hashes.at(-1).all,
      matchesNode: r === ref ? null : !d,
      firstDivergentTick: d ? d.t : null,
      divergentSubsystems: d ? d.subsystems : [],
    };
  }),
};
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.table(summary.engines.map((e) => ({ ...e, divergentSubsystems: e.divergentSubsystems.join(',') })));
process.exit(summary.engines.some((e) => e.matchesNode === false) ? 1 : 0);
