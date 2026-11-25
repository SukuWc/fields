// Replay determinism harness (docs/replay-determinism.md, milestones 1 and 2).
//
// Builds the multiplayer room default (defaultRoomConfig: the custom race
// course, gusts on) with a fixed room seed, the way apps/server/room.js
// applies a room config, spawns a few boats and feeds them a scripted,
// tick-stamped command log through the real command path (SimCore.command
// → Sim.command, and held helm / heading keys through SimCore.tick). Each
// tick is one fixed step of FixedStepLoop's dt (1/30 s), and a bit-exact state
// hash (src/state-hash.js) is taken every `every` ticks.
//
// No DOM, no Node APIs: the same module runs under node:test and in a
// browser bundle (scripts/determinism/browsers.mjs).
import { SimCore } from '../../src/host.js';
import { FixedStepLoop } from '../../src/loop.js';
import { settingDefault } from '../../src/settings-registry.js';
import { commandsFromConfig } from '../../src/room-config.js';
import { defaultRoomConfig } from '../../src/room-config.js';
import { validateRoomConfig } from '../../src/room-config.js';
import { CUSTOM_SCENARIO } from '../../src/custom-scenario.js';
import { hashCoreState } from '../../src/state-hash.js';

// The fixed tick the client loop and the server room use (30 Hz).
export const TICK_DT = new FixedStepLoop({ step() {} }).dt;

export const DEFAULT_SEED = 424242;

// Room default + wind schedule on with a fixed seed (sd 0 = exactly that seed).
export function roomConfig(seed = DEFAULT_SEED) {
  const cfg = defaultRoomConfig();
  cfg.wind_schedule = true;
  cfg.wind_schedule_seed = [seed, 0];
  return cfg;
}

// A SimCore set up like a server room after a config apply (Room._create,
// Room._roomCommand 'config', _reseedGustsFromRoomSeed, _restart).
export function buildCore(seed = DEFAULT_SEED) {
  const cfg0 = roomConfig(seed);
  const core = new SimCore({
    mapW: cfg0.map_width_m, mapH: cfg0.map_height_m,
    windAngle: cfg0.wind_angle_deg, windSpeed: cfg0.wind_speed_mps,
    simRes: settingDefault('simRes'), texture: undefined,
  });
  const v = validateRoomConfig(cfg0, { core, random: () => 0 });
  if (v.error) throw new Error('room config: ' + v.error);
  let layout;
  let scenario = null;
  for (const cmd of commandsFromConfig(v.config)) {
    if (cmd.type === 'restart') { scenario = cmd.scenario; layout = cmd.layout; continue; }
    core.command(cmd);
  }
  const w = core.sim.windSchedule;
  core.command({ type: 'gusts', ...(core.settings.gusts || {}), seed: w.seed >>> 0 });
  if (scenario !== CUSTOM_SCENARIO) throw new Error('expected the custom race course, got ' + scenario);
  core.command({ type: 'restart', scenario, layout });
  return core;
}

// Scripted, tick-stamped command log. Entries (sorted by t, then order):
//   { t, c }        one-shot command at the start of tick t (SimCore.command)
//   { t, hold: c }  held boat command from tick t on (helm / headingTarget)
//   { t, release }  stop holding the command with the same key
// Boats are spawned at tick 1 (the course is laid out on tick 0) and named
// by spawn id b1..bN, as the server addresses player boats.
export function commandLog(ticks, nBoats = 3) {
  const log = [];
  for (let i = 0; i < nBoats; i++) log.push({ t: 1, c: { type: 'spawnBoat', name: 'R' + (i + 1) } });
  const period = 240;
  for (let i = 0; i < nBoats; i++) {
    const boatId = 'b' + (i + 1);
    for (let base = 20 + i * 37; base < ticks; base += period) {
      const k = Math.floor(base / period);
      const helm = { type: 'helm', boatId, dir: (k + i) % 2 ? 1 : -1 };
      log.push({ t: base, hold: helm });
      log.push({ t: base + 12, release: helm });
      log.push({ t: base + 60, c: { type: 'tack', boatId } });
      const ht = { type: 'headingTarget', boatId, dir: (k % 2) ? 1 : -1 };
      log.push({ t: base + 120, hold: ht });
      log.push({ t: base + 128, release: ht });
      log.push({ t: base + 200, c: { type: 'autopilot', boatId } });
      log.push({ t: base + 215, c: { type: 'autopilot', boatId } });
    }
  }
  if (nBoats > 0) log.push({ t: 400, c: { type: 'penaltyTurn', boatId: 'b1', dir: 'cw' } });
  if (nBoats > 1) {
    log.push({ t: 500, c: { type: 'depower', boatId: 'b2' } });
    log.push({ t: 560, c: { type: 'depower', boatId: 'b2' } });
  }
  return log
    .map((e, i) => ({ ...e, i }))
    .filter((e) => e.t < ticks)
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map(({ i, ...e }) => e);
}

const SERVER_VIEW = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false, omitLadder: true };

// A run of `ticks` ticks, stepped in chunks (run.step(n)) so a browser page
// can report progress; hashes every `every` ticks (and the last one).
// present: build the scene frame each tick like a server room does.
// run.result() → { ticks, every, seed, nBoats, boats, hashes: [{ t, all,
// field, boats, wind, race }], msPerTick }.
export function createRun({ ticks = 300, every = 1, seed = DEFAULT_SEED, nBoats = 3, present = true, now = () => 0 } = {}) {
  const core = buildCore(seed);
  const log = commandLog(ticks, nBoats);
  const held = new Map();
  const hashes = [];
  let li = 0;
  let t = 0;
  let ms = 0;
  return {
    core,
    get done() { return t >= ticks; },
    get tick() { return t; },
    step(n = ticks) {
      const t0 = now();
      for (const end = Math.min(ticks, t + n); t < end; t++) {
        while (li < log.length && log[li].t === t) {
          const e = log[li++];
          if (e.c) core.command(e.c);
          else if (e.hold) held.set(JSON.stringify(e.hold), e.hold);
          else if (e.release) held.delete(JSON.stringify(e.release));
        }
        core.tick({ dt: TICK_DT, held: [...held.values()], present, view: SERVER_VIEW });
        if ((t + 1) % every === 0 || t === ticks - 1) hashes.push({ t: t + 1, ...hashCoreState(core) });
      }
      ms += now() - t0;
      return t;
    },
    result() {
      return { ticks: t, every, seed, nBoats, boats: core.sim.players.length, hashes, msPerTick: t ? ms / t : 0 };
    },
  };
}

export function runHarness(opts = {}) {
  const run = createRun(opts);
  run.step();
  return run.result();
}

// First hash record where a and b differ, with the subsystems that differ
// there (field / boats / wind / race), or null when they match.
export function firstDivergence(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].t !== b[i].t) return { t: a[i].t, reason: 'tick mismatch ' + a[i].t + ' vs ' + b[i].t, subsystems: [] };
    if (a[i].all !== b[i].all) {
      const subsystems = ['field', 'boats', 'wind', 'race'].filter((k) => a[i][k] !== b[i][k]);
      return { t: a[i].t, subsystems };
    }
  }
  if (a.length !== b.length) return { t: a[n - 1] ? a[n - 1].t : 0, reason: 'length ' + a.length + ' vs ' + b.length, subsystems: [] };
  return null;
}
