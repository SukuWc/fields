// Deterministic math guard (docs/replay-determinism.md): the sim path runs
// on the server and in every browser, and a replay re-simulates it, so it
// must not call the built-in transcendental Math functions (their last bit
// differs between engines and V8 versions) or use ** with an exponent other
// than a literal 2 (V8 and SpiderMonkey / JSC round integer powers
// differently). Use DMath (src/det-math.js) and x * x instead.
//
// SIM_FILES is the sim path; DISPLAY_FILES are in the SimCore / server import
// graph but only build or carry what the client draws (frames, guides,
// readouts, wire / field codecs, transport), so they may keep Math. A new file in that graph has to be put in one of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import planck from 'planck-js';
import { scanSimMath } from './sim-math-scan.mjs';
import { DMath } from '../src/det-math.js';
import '../src/map.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SIM_FILES = [
  'apps/server/room.js',
  'apps/server/replays.js',
  'src/state-hash.js',
  'src/replay-stepper.js',
  'src/boat-colors.js', 'src/boat-draw.js', 'src/boat.js', 'src/boltzmann.js', 'src/boundary-scenario.js',
  'src/boundary.js', 'src/course.js', 'src/custom-scenario.js', 'src/dev-config.js', 'src/dinghy-forces.js',
  'src/domainTrack.js', 'src/draw-order.js', 'src/finish-ghost.js', 'src/finish.js', 'src/foil.js', 'src/gusts.js',
  'src/heel.js', 'src/host-protocol.js', 'src/host.js', 'src/hud.js', 'src/leaderboard-view.js', 'src/leaderboard.js',
  'src/map-size.js', 'src/map.js', 'src/mark-touch.js', 'src/mark.js', 'src/present.js', 'src/race-bot.js',
  'src/race-lifecycle.js', 'src/room-config.js', 'src/rudder-limit.js', 'src/rule-text.js', 'src/rules.js',
  'src/scenarios.js', 'src/settings-registry.js', 'src/sim-modes.js', 'src/sim.js', 'src/start.js', 'src/utils.js',
  'src/vector-field.js', 'src/wind-schedule.js', 'src/wind.js',
];

const DISPLAY_FILES = [
  'apps/server/frame-times.js', 'apps/server/transport.js', 'src/boat-trails.js', 'src/field-codec.js', 'src/wire-codec.js',
  'src/boat-stats.js', 'src/fieldPainter.js', 'src/flow-tracers.js', 'src/instrument-chart.js',
  'src/instrument-readout.js', 'src/ladder-lines.js', 'src/row-outline.js', 'src/scene-build.js',
  'src/scene-state.js', 'src/svg-chart.js',
];

// The deterministic math itself (built-ins only in its large-argument
// fallback) and the planck-js hook.
const EXEMPT = ['src/det-math.js', 'src/planck-det.js'];

test('scanner finds Math calls and non-2 powers outside comments and strings', () => {
  const src = [
    'const a = Math.sin(x); // Math.cos(y) in a comment',
    "const s = 'Math.exp(1) ** 3';",
    '/* x ** 4 */ const b = x ** 2 + y ** 3;',
    'const c = DMath.atan2(y, x) + Math.sqrt(z) + Math.PI;',
    'const d = 2 ** k; let e = 1; e **= 2;',
  ].join('\n');
  const found = scanSimMath(src).map((f) => f.line + ' ' + f.kind);
  assert.deepEqual(found, ['1 Math.sin', '3 ** 3', '5 ** k']);
});

test('sim-path files use DMath and x * x, not built-in transcendental Math or ** n', () => {
  const bad = [];
  for (const f of SIM_FILES) {
    for (const x of scanSimMath(readFileSync(join(root, f), 'utf8'))) bad.push(`${f}:${x.line} ${x.kind}  ${x.text}`);
  }
  assert.deepEqual(bad, [], 'use DMath (src/det-math.js) / x * x:\n' + bad.join('\n'));
});

test('every file the sim host and the server room import is listed as sim or display', async () => {
  const r = await build({
    entryPoints: [join(root, 'src/host.js'), join(root, 'apps/server/room.js')],
    bundle: true, write: false, outdir: '/tmp/det-math-guard', metafile: true, platform: 'node', format: 'esm',
    logLevel: 'silent', packages: 'external', absWorkingDir: root,
  });
  const inGraph = Object.keys(r.metafile.inputs).filter((f) => f.startsWith('src/') || f.startsWith('apps/'));
  const known = new Set([...SIM_FILES, ...DISPLAY_FILES, ...EXEMPT]);
  const missing = inGraph.filter((f) => !known.has(f));
  assert.deepEqual(missing, [], 'add to SIM_FILES (affects sim state) or DISPLAY_FILES (drawing / transport only):\n' + missing.join('\n'));
});

test('planck-js rotations use DMath (src/planck-det.js, loaded by map.js)', () => {
  for (const k of ['sin', 'cos', 'atan2']) assert.equal(planck.Math[k], DMath[k], k);
  assert.notEqual(Math.sin, DMath.sin, 'the global Math stays untouched');
  const r = planck.Rot(1.234);
  assert.equal(r.s, DMath.sin(1.234));
  assert.equal(r.getAngle(), DMath.atan2(r.s, r.c));
});
