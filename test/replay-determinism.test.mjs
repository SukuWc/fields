// Replay determinism, milestone 1 (docs/replay-determinism.md): the room
// default race (custom course, gusts, wind schedule with a fixed seed, three
// boats driven by a tick-stamped command log) gives bit-identical state
// hashes on every tick, run twice in this process and once in a separate
// Node process. REPLAY_TICKS=N runs longer (default 150 ticks = 5 s).
import './dom-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandLog } from '../scripts/determinism/harness.mjs';
import { firstDivergence } from '../scripts/determinism/harness.mjs';
import { runHarness } from '../scripts/determinism/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TICKS = Number(process.env.REPLAY_TICKS) || 150;

const quiet = (f) => {
  const l = console.log;
  console.log = () => {};
  try { return f(); } finally { console.log = l; }
};

const a = quiet(() => runHarness({ ticks: TICKS }));

test('the command log drives the real boat commands', () => {
  const log = commandLog(TICKS);
  const kinds = new Set(log.map((e) => (e.c ? e.c.type : (e.hold || e.release).type)));
  for (const k of ['spawnBoat', 'helm', 'tack', 'headingTarget']) assert.ok(kinds.has(k), k);
  assert.equal(a.boats, 3);
  assert.equal(a.hashes.length, TICKS);
  // The state moves: field, boats and wind all change over the run.
  for (const k of ['field', 'boats', 'wind', 'race']) assert.notEqual(a.hashes[5][k], a.hashes.at(-1)[k], k);
});

test('same seed and commands → identical hashes on every tick (in process)', () => {
  const b = quiet(() => runHarness({ ticks: TICKS }));
  const d = firstDivergence(a.hashes, b.hashes);
  assert.equal(d, null, d && `first divergent tick ${d.t}: ${d.subsystems.join(', ')}`);
});

test('a separate Node process gives the same hashes on every tick', () => {
  const r = spawnSync(process.execPath, ['--import', './test/register.mjs', 'scripts/determinism/node-run.mjs', '--ticks', String(TICKS)], {
    cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(r.stdout);
  const d = firstDivergence(a.hashes, c.hashes);
  assert.equal(d, null, d && `first divergent tick ${d.t}: ${d.subsystems.join(', ')}`);
});
