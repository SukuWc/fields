// In-memory race replays (docs/replay-determinism.md, milestone 3 groundwork).
//
// A RaceRecorder wraps one SimCore from the moment it is built (every race
// starts on a fresh core, see Room._freshCore) and records everything that
// changes sim state: the constructor options, every top-level
// SimCore.command (spawn / remove / autopilot gains / room settings / config
// applies / restarts / penalties ...) stamped with the number of ticks done
// so far, and the tick inputs (held helm / autopilot commands, dt, present,
// view) whenever they change. Every REPLAY_HASH_EVERY ticks it stores the
// state hash (src/state-hash.js). With the deterministic sim math (#245) the
// log replays bit-identically: resimulate(record) rebuilds the core and
// checks the hashes.
//
// Storage is a module-level ring buffer in RAM (no database): the last
// REPLAY_KEEP finished races of the whole server, oldest dropped first. A
// restart of the Node process forgets them.
import fs from 'node:fs';
import { hashCoreState } from '../../src/state-hash.js';
import { ReplayStepper } from '../../src/replay-stepper.js';
import { REPLAY_TICK_DT as STEP_TICK_DT } from '../../src/replay-stepper.js';
import { REPLAY_HASH_EVERY as STEP_HASH_EVERY } from '../../src/replay-stepper.js';

export const REPLAY_KEEP = 3;
export const REPLAY_HASH_EVERY = STEP_HASH_EVERY;
export const REPLAY_TICK_DT = STEP_TICK_DT;
// A race with no player boat on the water for this many ticks (60 s) ends
// (Room._compute): an idle persistent room does not grow a log forever, and
// the next join starts a new race (Room._command spawnBoat).
export const REPLAY_IDLE_TICKS = 60 * 30;
// Longest recording (2 h of sim time); past it the race is kept as truncated.
export const REPLAY_MAX_TICKS = 2 * 3600 * 30;

const finished = [];
let seq = 0;
let buildVersion = null;

function packageVersion() {
  try {
    const p = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return p && p.version ? 'package ' + p.version : 'dev';
  } catch { return 'dev'; }
}

function envVersion() {
  for (const key of ['SOURCE_COMMIT', 'COMMIT_SHA', 'GIT_COMMIT', 'GIT_SHA']) {
    const raw = (process.env[key] || '').trim();
    if (raw && raw !== 'dev') return raw;
  }
  return null;
}

/** Build version stored with each race (git sha when the deploy provides one). */
export function replayBuildVersion() {
  if (!buildVersion) buildVersion = envVersion() || packageVersion();
  return buildVersion;
}

/** Set by startServer from /api/version (version.json or SOURCE_COMMIT). */
export function setReplayBuildVersion(v) {
  buildVersion = v && v !== 'dev' ? String(v) : null;
}

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

// Finish results: RaceResults.toData() with boat ids and names, and the
// player boats at the end of the race.
export function raceResultsOf(core) {
  const sim = core.sim;
  const name = (i) => (sim.players[i] ? sim.players[i].spawnName || null : null);
  const id = (i) => (sim.players[i] ? sim.players[i].spawnId || null : null);
  const rr = sim.raceResults;
  return {
    finished: rr ? rr.toData().map((e) => ({ ...e, id: id(e.boat), name: name(e.boat) })) : [],
    boats: sim.players.filter((b) => b.spawnId).map((b) => ({ id: b.spawnId, name: b.spawnName || null })),
  };
}

export class RaceRecorder {
  /**
   * room: room name; opts: the SimCore constructor options; nextSpawn: the
   * spawn id counter the room carried over (Sim._nextSpawn, set before any
   * command); now: wall clock (ms).
   */
  constructor({ room, core, opts, nextSpawn = 1, now = Date.now }) {
    this.room = room;
    this.core = core;
    this.now = now;
    this.startedAt = now();
    this.start = { opts: clone(opts), nextSpawn };
    this.log = [];
    this.hashes = [];
    this.t = 0;
    this.simTime = 0;
    this.players = [];
    this.stopped = null;
    this._depth = 0;
    this._inTick = false;
    this.inTickCommands = 0;
    this._held = undefined;
    this._present = undefined;
    this._view = undefined;
    this._lastRacer = 0;
    this._attach(core);
  }

  _attach(core) {
    const command = core.command.bind(core);
    const tick = core.tick.bind(core);
    core.command = (c) => {
      // Only top-level commands: SimCore expands a config into nested calls.
      // A command from inside a tick (an event handler) could not be replayed
      // at a tick boundary: counted, and the tests keep it at 0.
      if (this._depth === 0 && this._inTick) this.inTickCommands++;
      if (this._depth === 0 && !this.stopped) this.log.push({ t: this.t, c: clone(c) });
      this._depth++;
      let r;
      try { r = command(c); } finally { this._depth--; }
      if (this._depth === 0 && c && c.type === 'spawnBoat' && r && r.id) this.players.push({ id: r.id, name: r.name || null, t: this.t });
      return r;
    };
    core.tick = (req) => {
      if (!this.stopped) this._input(req || {});
      this._inTick = true;
      let out;
      try { out = tick(req); } finally { this._inTick = false; }
      if (!this.stopped) this._ticked(req || {});
      return out;
    };
  }

  // A tick without dt only builds a frame (no step): not recorded.
  _input(req) {
    if (req.dt === undefined) return;
    const e = { t: this.t };
    let any = false;
    if (req.dt !== REPLAY_TICK_DT) { e.dt = req.dt; any = true; }
    const held = JSON.stringify(req.held || []);
    if (held !== this._held) { this._held = held; e.held = clone(req.held || []); any = true; }
    const present = !!req.present;
    if (present !== this._present) { this._present = present; e.present = present; any = true; }
    const view = JSON.stringify(req.view || null);
    if (view !== this._view) { this._view = view; e.view = clone(req.view || null); any = true; }
    if (any) this.log.push(e);
  }

  _ticked(req) {
    if (req.dt === undefined) return;
    this.t++;
    this.simTime += req.dt;
    if (this.t % REPLAY_HASH_EVERY === 0) this.hashes.push({ t: this.t, ...hashCoreState(this.core) });
    if (this.core.sim.players.some((b) => b.spawnId)) this._lastRacer = this.t;
    if (this.t >= REPLAY_MAX_TICKS) this.stopped = 'truncated';
    else if (this.t - this._lastRacer >= REPLAY_IDLE_TICKS) this.stopped = 'idle';
  }

  /** Why the room should end this race now ('truncated' | 'idle'), or null. */
  get due() { return this.stopped; }

  /**
   * End of the race. Returns the record, or null for a race no player boat
   * joined. extra: { config (room TOML), seed (Room.windSeed()) }.
   */
  finish(reason, { config = null, seed = null, buildVersion: bv = replayBuildVersion() } = {}) {
    if (!this.players.length) return null;
    const end = this.stopped === 'truncated' ? 'truncated' : reason;
    const last = this.hashes[this.hashes.length - 1];
    const finalHash = last && last.t === this.t ? last : { t: this.t, ...hashCoreState(this.core) };
    this.stopped = this.stopped || 'finished';
    const names = [...new Set(this.players.map((p) => p.name).filter(Boolean))];
    return {
      id: `${this.room}-${this.startedAt.toString(36)}-${(++seq).toString(36)}`,
      room: this.room,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(this.now()).toISOString(),
      durationS: Math.round(this.simTime * 1000) / 1000,
      ticks: this.t,
      endReason: end,
      players: names,
      buildVersion: bv,
      config,
      seed,
      start: this.start,
      hashEvery: REPLAY_HASH_EVERY,
      log: this.log,
      spawns: this.players,
      inTickCommands: this.inTickCommands,
      hashes: this.hashes,
      finalHash,
      results: raceResultsOf(this.core),
    };
  }
}

/** Keep a finished race (ring of REPLAY_KEEP, server-wide). */
export function saveReplay(record) {
  if (!record) return;
  finished.push(record);
  while (finished.length > REPLAY_KEEP) finished.shift();
}

/** Newest first: { id, room, startedAt, endedAt, durationS, ticks, players, buildVersion, endReason, seed }. */
export function listReplays() {
  return finished.slice().reverse().map((r) => ({
    id: r.id, room: r.room, startedAt: r.startedAt, endedAt: r.endedAt, durationS: r.durationS, ticks: r.ticks,
    players: r.players, buildVersion: r.buildVersion, endReason: r.endReason, seed: r.seed,
  }));
}

export function getReplay(id) {
  return finished.find((r) => r.id === id) || null;
}

export function clearReplays() {
  finished.length = 0;
}

/**
 * Re-run a record on a fresh SimCore in this process (src/replay-stepper.js,
 * the same stepping the browser replay player uses). Returns { hashes (at
 * the record's hash ticks), finalHash, results, firstMismatch } where
 * firstMismatch is the first stored hash that differs ({ t, want, got }) or null.
 */
export function resimulate(record) {
  const stepper = new ReplayStepper(record);
  const r = stepper.run();
  return { ...r, results: raceResultsOf(stepper.core) };
}
