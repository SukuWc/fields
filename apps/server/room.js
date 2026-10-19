// One room = one authoritative SimCore (src/host.js) and the clients
// connected to it. Speaks the host protocol (src/host-protocol.js).
//
// Ticks: by default the room runs on its own fixed 30 Hz clock (see _start:
// a frame is broadcast at the end of its slot, never faster than 30 Hz, no
// catch-up bursts) and sends every frame to every client. Held keys: each
// client's latest 'input' ({ held }), applied to that client's own boats only
// (see Player boats). With lockstep, clients' 'tick' messages drive the room
// instead (reproducible runs, tests; any client's tick steps it).
//
// Field streaming: each client says whether it shows the field and which
// plot ({ type: 'field', on, plotType, contrastExp }; a 'plot' command sets
// the plot too). Every TICK_HZ / fieldHz ticks (default FIELD_HZ, fieldHz 0 =
// no field) the room encodes the lattice once per distinct plot among the
// clients that show it (fieldPainter.js encodeFieldGrids: the root grid and
// every refinement domain as its own grid, one byte per cell) and sends it as
// one binary message to those clients only. Nobody showing it, or dev mode
// (frozen lattice, the page hides the field): nothing is encoded.
//
// Frames carry compact scene state (src/scene-state.js), not geometry; each
// client builds its guides and body outlines (src/scene-build.js). Statics
// (hull and body shapes, course layout, ...) are not in the broadcast frame:
// a client gets { type: 'statics', sv, statics } before the first frame it
// needs them for (on join, and again whenever they change, e.g. a restart or
// a spawned boat). Numbers in these JSON messages are rounded to 1e-4
// (roundJson), which is well under a pixel at any zoom; values that end up
// as text (state.hud, penalty badges, finish labels) stay exact.
import { SimCore } from '../../src/host.js';
import { answer, eventForClient, EXACT_JSON } from '../../src/host-protocol.js';
import { BOAT_ACTIONS, SIM_RES_MODES } from '../../src/sim.js';
import { encodeFieldGrids } from '../../src/fieldPainter.js';
import { scenarioExtent, WALL_INSET_M } from '../../src/map-size.js';

// Player boats: a client may spawn boats ({ type: 'spawnBoat', name?, color? },
// at most MAX_BOATS_PER_CLIENT each and MAX_PLAYER_BOATS per room) and owns
// them. Its boat commands and held keys are remapped: { boat: k } means its
// k-th own boat (boatId). On the server clock a client steers only its own
// boats: without one (a spectator, or after Leave) its boat commands and
// keys are dropped, never applied to scenario boats or other players' boats,
// and each boat has exactly one owner, so keys from several clients never
// combine on one boat. (A lockstep room, tests only, still lets a client
// without boats drive scenario boats 0/1, as the local and worker modes do.)
// removeBoat only works on own boats; a disconnect removes them all. A
// room-wide restart keeps them: each is spawned again, with its name and
// colour, once the new scenario has placed its own boats (after its first
// tick). Each client hears its list as
// { type: 'event', ev: { type: 'ownBoats', boats: [{ id, name, color }] } }
// and its key binding as { type: 'event', ev: { type: 'bindControls', boats } }
// (1 with an own boat, else 0; the scenario's own bindControls is not sent
// on the server clock).
//
// Room-wide settings (ROOM_COMMANDS: restart, wind, devMode, barrier,
// simRes, amrMode, cellBudget, options): any client may send them (no owner
// for now); each is validated (validateRoomCommand) and refused with
// { error } when invalid. After a change every client gets
// { type: 'event', ev: { type: 'room', room } } (room: SimCore.roomState(),
// scenario index / title / description, settings, lattice). A simRes or
// amrMode change that rebuilds the lattice restarts the scenario here.
//
// Joining: the reply to 'init' is one welcome message
//   { type: 'welcome', info, room, own: [...], bindings }
// The first client's init options create the Sim (map size, simRes, and
// scenario: the scenario loaded at creation); a later init changes nothing.
//
// Per-client subscriptions: 'field' (above), { type: 'flow', on } (flow
// tracers: the wind grid, sent as { type: 'flow', flow } before the frame,
// only to those clients) and { type: 'perf', on } (perf counters, sent as
// { type: 'perf', perf }). The broadcast frame carries neither.

// Reconnect: a client that sends a token in init ({ type: 'init', opts,
// token }) is known again on a later connection. When it disconnects, its
// boats stay in the room for graceMs (GRACE_MS, server --grace-s) instead of
// being removed: they keep sailing (on autopilot if they were) and nobody can
// steer them. An init with the same token within that time gets them back
// (same ids, ownership and key binding, in its welcome); a different token
// cannot. After graceMs they are removed. A room-wide restart in between
// spawns them again for the absent owner too. Without a token a disconnect
// removes the boats at once, as before. An empty room is kept (its clock
// paused) for graceMs too, so a reload or a short drop of the last client
// finds it as it was; then it is dropped (onDispose).
export const GRACE_MS = 30000;
export const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const MAX_BOATS_PER_CLIENT = 1;
export const MAX_PLAYER_BOATS = 8;
export const MAX_WIND_MPS = 30;
export const ROOM_COMMANDS = new Set(['restart', 'wind', 'devMode', 'barrier', 'simRes', 'amrMode', 'cellBudget', 'options']);

// A room-wide command checked against the room: { c } (normalised) or
// { error }.
export function validateRoomCommand(c, core) {
  const bool = (v) => typeof v === 'boolean';
  switch (c.type) {
    case 'restart': {
      const n = Number(c.scenario);
      const sc = core.sim.scenarios;
      if (!Number.isInteger(n) || n < 0 || n >= sc.length || !sc[n]) return { error: 'no scenario ' + c.scenario };
      const e = scenarioExtent(n);
      if (e.x > core.map.width / 2 - WALL_INSET_M || e.y > core.map.height / 2 - WALL_INSET_M) return { error: 'scenario ' + n + ' does not fit this ' + core.map.width + ' x ' + core.map.height + ' m room' };
      return { c: { type: 'restart', scenario: n } };
    }
    case 'wind': {
      const out = { type: 'wind' };
      if (c.angle !== undefined) {
        if (!Number.isFinite(c.angle)) return { error: 'bad wind angle' };
        out.angle = ((c.angle % 360) + 360) % 360;
      }
      if (c.speed !== undefined) {
        if (!Number.isFinite(c.speed) || c.speed < 0 || c.speed > MAX_WIND_MPS) return { error: 'wind speed must be 0..' + MAX_WIND_MPS + ' m/s' };
        out.speed = c.speed;
      }
      if (!('angle' in out) && !('speed' in out)) return { error: 'wind needs angle or speed' };
      return { c: out };
    }
    case 'devMode': case 'barrier':
      return bool(c.on) ? { c: { type: c.type, on: c.on } } : { error: c.type + ' needs on: true | false' };
    case 'simRes':
      return Object.prototype.hasOwnProperty.call(SIM_RES_MODES, c.mode) ? { c: { type: 'simRes', mode: c.mode } } : { error: 'unknown simRes ' + c.mode };
    case 'amrMode':
      return c.mode === 'auto' || c.mode === 'fixed' ? { c: { type: 'amrMode', mode: c.mode } } : { error: 'amrMode must be auto or fixed' };
    case 'cellBudget': {
      if (!bool(c.tune)) return { error: 'cellBudget needs tune: true | false' };
      if (c.target !== null && c.target !== undefined && !(Number.isFinite(c.target) && c.target >= 1000 && c.target <= 1e8)) return { error: 'cellBudget target must be 1000..1e8 or null' };
      return { c: { type: 'cellBudget', tune: c.tune, target: c.target ?? null } };
    }
    case 'options': {
      const out = { type: 'options' };
      for (const k of ['amr', 'boatEnergy']) {
        if (!(k in c)) continue;
        if (!bool(c[k])) return { error: k + ' must be true | false' };
        out[k] = c[k];
      }
      return Object.keys(out).length > 1 ? { c: out } : { error: 'options needs amr or boatEnergy' };
    }
    default: return { error: 'unknown command ' + c.type };
  }
}

export const TICK_HZ = 30;

// JSON for state messages: non-integer numbers rounded to 4 decimals, except
// multiples of 1/4096 (cell sizes such as 0.03125 and the like are scale
// factors, kept exact; they print short anyway).
// Objects marked with host-protocol.js markExact (HUD values, badge numbers)
// keep their numbers exact.
function roundNum(_k, v) {
  return typeof v === 'number' && !Number.isInteger(v * 4096) && !this[EXACT_JSON] ? Math.round(v * 1e4) / 1e4 : v;
}
export function roundJson(m) { return JSON.stringify(m, roundNum); }
export const FIELD_HZ = 2;

export class Room {
  constructor(name, { lockstep = false, fieldHz = FIELD_HZ, now = () => performance.now(), graceMs = GRACE_MS } = {}) {
    this.name = name;
    this.graceMs = graceMs;
    // Per client: its token (init). Per absent token: { boats, timer, until }.
    this.tokens = new Map();
    this.parked = new Map();
    this._emptyTimer = null;
    // Called once the room is empty for good (index.js drops it).
    this.onDispose = null;
    this.lockstep = lockstep;
    this.fieldHz = fieldHz;
    // Per client: { on, plotType, contrastExp } (absent = field off).
    this.fieldSubs = new Map();
    // Clients that asked for flow tracer grids / perf counters.
    this.flowSubs = new Set();
    this.perfSubs = new Set();
    this.fieldEncodes = 0;
    this.fieldBytesSent = 0;
    this.fieldEncodeMs = 0;
    this.now = now;
    this.core = null;
    this.clients = new Set();
    this.inputs = new Map();
    // Per client: [{ id, name, color }] own boats.
    this.owned = new Map();
    // After a room-wide restart: per client [{ name, color }] to spawn again.
    this._respawn = null;
    this._restarting = false;
    this.ticks = 0;
    this.broadcasts = 0;
    // Statics version last sent to each client; bytes of frame and statics
    // messages sent (all clients).
    this.staticsSent = new Map();
    this.frameBytesSent = 0;
    this.staticsBytesSent = 0;
    this.lastFrameBytes = 0;
    this.timer = null;
    this.tickMs = 0;
  }

  // First client's init options build the Sim (and load opts.scenario);
  // later clients join it as it is.
  _create(opts) {
    const o = opts || {};
    const core = new SimCore({
      mapW: o.mapW || 100, mapH: o.mapH || 200, windAngle: o.windAngle ?? 90, windSpeed: o.windSpeed ?? 4.5,
      simRes: Object.prototype.hasOwnProperty.call(SIM_RES_MODES, o.simRes) ? o.simRes : '4f',
      // No texture: the server never paints RGBA (the painter is inert);
      // field messages are encoded from the lattice when due (_fieldMessages).
      texture: undefined,
    });
    core.sim.on((ev) => {
      if (!this.lockstep) {
        // Key bindings are per client (_sendBindings), not the scenario's.
        if (ev.type === 'bindControls') return;
        if (ev.type === 'cleared' && !this._restarting) this._dropOwnership();
      }
      this.broadcast({ type: 'event', ev: eventForClient(core, ev) });
    });
    this.core = core;
    if (o.scenario !== undefined && o.scenario !== null) {
      const v = validateRoomCommand({ type: 'restart', scenario: o.scenario }, core);
      if (v.c) core.command(v.c);
    }
    if (!this.lockstep) this._start();
  }

  info() { return { ...this.core.info(), mode: this.lockstep ? 'client' : 'server', room: this.name }; }

  join(client) {
    this.clients.add(client);
    if (this._emptyTimer) { clearTimeout(this._emptyTimer); this._emptyTimer = null; }
    // Back from empty: the clock runs again.
    if (this.core && !this.lockstep && !this.timer) this._start();
  }

  leave(client) {
    const token = this.tokens.get(client);
    const list = this.owned.get(client) || [];
    const specs = this._respawn && this._respawn.get(client);
    if (token && this.graceMs > 0 && this.core && (list.length || specs)) {
      // Keep the boats for the owner's return (see GRACE_MS).
      const prev = this.parked.get(token);
      if (prev) clearTimeout(prev.timer);
      const entry = { parked: true, token, boats: list, until: this.now() + this.graceMs };
      entry.timer = setTimeout(() => this._expire(token), this.graceMs);
      this.parked.set(token, entry);
      if (specs) { this._respawn.delete(client); this._respawn.set(entry, specs); }
    } else {
      for (const b of list) this.core.command({ type: 'removeBoat', id: b.id });
      if (this._respawn) this._respawn.delete(client);
    }
    this.tokens.delete(client);
    this.owned.delete(client);
    this.clients.delete(client);
    this.inputs.delete(client);
    this.fieldSubs.delete(client);
    this.flowSubs.delete(client);
    this.perfSubs.delete(client);
    this.staticsSent.delete(client);
    if (this.clients.size === 0) {
      // Paused while empty (no CPU), kept for graceMs, then dropped.
      this.stop();
      if (this.graceMs > 0 && this.core) this._emptyTimer = setTimeout(() => this._dispose(), this.graceMs);
      else this._dispose();
    }
  }

  // Grace period over: the absent owner's boats go.
  _expire(token) {
    const e = this.parked.get(token);
    if (!e) return;
    this.parked.delete(token);
    if (this._respawn) this._respawn.delete(e);
    for (const b of e.boats) this.core.command({ type: 'removeBoat', id: b.id });
  }

  // A returning client (same token): its boats, ownership and binding back.
  _reclaim(client, token) {
    const e = this.parked.get(token);
    if (!e) return;
    clearTimeout(e.timer);
    this.parked.delete(token);
    this.owned.set(client, e.boats);
    if (this._respawn && this._respawn.has(e)) { this._respawn.set(client, this._respawn.get(e)); this._respawn.delete(e); }
  }

  _dispose() {
    if (this._emptyTimer) clearTimeout(this._emptyTimer);
    this._emptyTimer = null;
    if (this.clients.size > 0) return;
    for (const e of this.parked.values()) clearTimeout(e.timer);
    this.parked.clear();
    this.stop();
    if (this.onDispose) this.onDispose(this);
  }

  send(client, m) { client.send(JSON.stringify(m)); }
  broadcast(m) { const s = JSON.stringify(m); for (const c of this.clients) c.send(s); }

  _ownList(client) { return (this.owned.get(client) || []).map((b) => ({ id: b.id, name: b.name, color: b.color })); }
  _bindings(client) {
    if (this.lockstep) { const own = (this.owned.get(client) || []).length; return own > 0 ? Math.min(own, 2) : this.core.sim.players.length; }
    return Math.min((this.owned.get(client) || []).length, 2);
  }

  message(client, m) {
    if (m.type === 'init') {
      if (!this.core) this._create(m.opts);
      if (typeof m.token === 'string' && TOKEN_RE.test(m.token) && !this.tokens.has(client)) {
        this.tokens.set(client, m.token);
        this._reclaim(client, m.token);
      }
      this.send(client, { type: 'welcome', info: this.info(), room: this.core.roomState(), own: this._ownList(client), bindings: this._bindings(client) });
      return;
    }
    if (m.type === 'field') { this._setField(client, m); return; }
    if (m.type === 'flow') { if (m.on) this.flowSubs.add(client); else this.flowSubs.delete(client); return; }
    if (m.type === 'perf') { if (m.on) this.perfSubs.add(client); else this.perfSubs.delete(client); return; }
    if (!this.core) return;
    if (m.type === 'command') {
      const c = m.c && typeof m.c === 'object' ? m.c : {};
      this.send(client, { type: 'result', id: m.id, r: this._command(client, c) });
      return;
    }
    if (m.type === 'query') { this.send(client, answer(this.core, m)); return; }
    if (m.type === 'input') this.inputs.set(client, { held: Array.isArray(m.held) ? m.held : [] });
    else if (m.type === 'tick' && this.lockstep && m.req) {
      const held = (m.req.held || []).map((c) => this._mapBoat(client, c)).filter(Boolean);
      this.step({ ...m.req, held });
    }
  }

  // One command from a client; returns the result to send back.
  _command(client, c) {
    // Plot options are per client (they only shape its field messages).
    if (c.type === 'plot') {
      this._setField(client, { ...(this.fieldSubs.get(client) || { on: false }), plotType: c.plotType, contrastExp: c.contrastExp });
      return undefined;
    }
    if (c.type === 'spawnBoat') {
      const list = this.owned.get(client) || [];
      if (list.length >= MAX_BOATS_PER_CLIENT) return { error: 'at most ' + MAX_BOATS_PER_CLIENT + ' boat per client' };
      if (this.core.sim.players.filter((b) => b.spawnId).length >= MAX_PLAYER_BOATS) return { error: 'the room is full (' + MAX_PLAYER_BOATS + ' player boats)' };
      const name = typeof c.name === 'string' ? c.name.trim().slice(0, 24) : '';
      const color = Number.isInteger(c.color) && c.color >= 0 && c.color <= 0xffffff ? c.color : undefined;
      const r = this._spawn(client, { name, color });
      this._sendOwn(client);
      return r;
    }
    if (c.type === 'removeBoat') {
      const list = this.owned.get(client) || [];
      const i = list.findIndex((b) => b.id === c.id);
      const r = i >= 0 && this.core.command({ type: 'removeBoat', id: c.id });
      if (i >= 0) list.splice(i, 1);
      this._sendOwn(client);
      return !!r;
    }
    if (BOAT_ACTIONS[c.type]) {
      const mapped = this._mapBoat(client, c);
      return mapped ? this.core.command(mapped) : undefined;
    }
    if (ROOM_COMMANDS.has(c.type)) {
      const v = validateRoomCommand(c, this.core);
      if (v.error) return { error: v.error };
      const r = this._roomCommand(v.c);
      this.broadcast({ type: 'event', ev: { type: 'room', room: this.core.roomState() } });
      return r;
    }
    return { error: 'unknown command ' + c.type };
  }

  _roomCommand(c) {
    if (c.type === 'restart') return this._restart(c.scenario);
    const r = this.core.command(c);
    // A rebuilt lattice restarts the scenario (the page used to click Restart).
    if ((c.type === 'simRes' || c.type === 'amrMode') && r && r.rebuilt && Number.isInteger(this.core.sim.scenarioIndex)) {
      this._restart(this.core.sim.scenarioIndex);
    }
    return r;
  }

  // Room-wide restart that keeps player boats (spawned again after the
  // scenario's first tick, see _compute).
  _restart(n) {
    const keep = new Map();
    for (const [client, list] of this.owned) if (list.length) keep.set(client, list.map((b) => ({ name: b.name, color: b.color })));
    // Absent owners' boats (grace period) come back too.
    for (const e of this.parked.values()) if (e.boats.length) { keep.set(e, e.boats.map((b) => ({ name: b.name, color: b.color }))); }
    this._restarting = true;
    let r;
    try { r = this.core.command({ type: 'restart', scenario: n }); } finally { this._restarting = false; }
    for (const key of keep.keys()) { if (key.parked) key.boats = []; else this.owned.set(key, []); }
    if (keep.size) this._respawn = keep;
    return r;
  }

  _spawn(client, { name, color }) {
    const r = this.core.command({ type: 'spawnBoat', name, color });
    const list = this.owned.get(client) || [];
    list.push({ id: r.id, name: r.name, color });
    this.owned.set(client, list);
    return r;
  }

  // Player boats kept across a restart, once the scenario placed its boats.
  _respawnDue() {
    if (!this._respawn || this.core.sim.frame < 3) return;
    const due = this._respawn;
    this._respawn = null;
    for (const [key, specs] of due) {
      if (key.parked) {
        if (this.parked.get(key.token) !== key) continue;
        for (const sp of specs) { const r = this.core.command({ type: 'spawnBoat', name: sp.name, color: sp.color }); key.boats.push({ id: r.id, name: r.name, color: sp.color }); }
        continue;
      }
      if (!this.clients.has(key)) continue;
      for (const sp of specs) this._spawn(key, sp);
      this._sendOwn(key);
    }
  }

  // A boat command from this client, aimed at its own boat. Without one:
  // nothing on the server clock; scenario boats in a lockstep room.
  _mapBoat(client, c) {
    const list = this.owned.get(client);
    if (!list || list.length === 0) return this.lockstep ? c : null;
    const own = list[Number.isInteger(c.boat) ? c.boat : 0];
    if (!own) return null;
    const { boat: _b, boatId: _i, ...rest } = c;
    return { ...rest, boatId: own.id };
  }

  _setField(client, m) {
    const prev = this.fieldSubs.get(client) || { on: false, plotType: 3, contrastExp: 0 };
    this.fieldSubs.set(client, {
      on: 'on' in m ? !!m.on : prev.on,
      plotType: Number.isFinite(m.plotType) ? m.plotType : prev.plotType,
      contrastExp: Number.isFinite(Number(m.contrastExp)) && m.contrastExp !== undefined ? Number(m.contrastExp) : prev.contrastExp,
    });
  }

  // Field messages due this tick: [{ clients, buf }] per distinct plot among
  // the clients showing the field; [] (and no encoding) if none does.
  _fieldMessages() {
    if (this.core.map.devMode) return [];
    const groups = new Map();
    for (const [client, sub] of this.fieldSubs) {
      if (!sub.on || !this.clients.has(client)) continue;
      const key = sub.plotType + '|' + sub.contrastExp;
      let g = groups.get(key);
      if (!g) { g = { plot: sub, clients: [] }; groups.set(key, g); }
      g.clients.push(client);
    }
    const out = [];
    for (const g of groups.values()) {
      const t0 = this.now();
      const u8 = encodeFieldGrids(this.core.bm, g.plot);
      this.fieldEncodeMs = this.now() - t0;
      this.fieldEncodes++;
      out.push({ clients: g.clients, buf: Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength) });
    }
    return out;
  }

  _sendOwn(client) {
    if (!this.clients.has(client)) return;
    this.send(client, { type: 'event', ev: { type: 'ownBoats', boats: this._ownList(client) } });
    this.send(client, { type: 'event', ev: { type: 'bindControls', boats: this._bindings(client) } });
  }

  _dropOwnership() {
    const had = [...this.owned.keys()];
    this.owned.clear();
    for (const c of had) this._sendOwn(c);
  }

  _heldUnion() {
    const seen = new Set();
    const out = [];
    for (const [client, { held }] of this.inputs) {
      for (const c0 of held) {
        if (!c0 || !BOAT_ACTIONS[c0.type]) continue;
        const c = this._mapBoat(client, c0);
        if (!c) continue;
        const k = JSON.stringify(c);
        if (!seen.has(k)) { seen.add(k); out.push(c); }
      }
    }
    return out;
  }

  // What the host reads from the view: flow tracer grids while any client
  // shows them (the camera and the other toggles are the client's own).
  _view() {
    return { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: this.flowSubs.size > 0 };
  }

  // Compute one tick (req as SimCore.tick in lockstep, else built from the
  // inputs). Returns what to broadcast; nothing is sent here.
  _compute(req) {
    const r = req ? { ...req, view: { ...(req.view || {}), show_fields: this.flowSubs.size > 0 } } : { dt: 1 / TICK_HZ, held: this._heldUnion(), present: true, view: this._view() };
    this.core.perf = this.perfSubs.size > 0;
    const every = this.fieldHz > 0 ? Math.max(1, Math.round(TICK_HZ / this.fieldHz)) : 0;
    const fieldDue = every && r.dt !== undefined && this.ticks % every === 0;
    const t0 = this.now();
    const frame = this.core.tick(r);
    this.tickMs = this.now() - t0;
    if (r.dt !== undefined) this.ticks++;
    this._respawnDue();
    frame.fieldReady = false;
    // Per-client extras go to their subscribers only (_publish).
    const flow = frame.flow || null, perf = frame.perf || null;
    delete frame.flow;
    delete frame.perf;
    // Room tick number: increases by one per tick, the same on every client.
    frame.tick = this.ticks;
    // Statics go out as their own message (_publish), not in the frame.
    delete frame.statics;
    const statics = frame.state ? { sv: this.core.staticsVersion, statics: this.core.statics } : null;
    const fields = fieldDue ? this._fieldMessages() : [];
    return { frame, fields, statics, flow, perf };
  }

  // Every client in the room gets every frame; the server never waits on a
  // client (ws buffers per socket). The field (binary) goes first so a
  // client drawing on the frame message already has the new texture, and
  // so does a statics message a client has not had yet.
  _publish({ frame, fields, statics, flow, perf }) {
    for (const f of fields || []) {
      for (const c of f.clients) {
        if (!this.clients.has(c)) continue;
        c.send(f.buf);
        this.fieldBytesSent += f.buf.length;
      }
    }
    if (statics && statics.statics) {
      let msg = null;
      for (const c of this.clients) {
        if (this.staticsSent.get(c) === statics.sv) continue;
        msg = msg || roundJson({ type: 'statics', sv: statics.sv, statics: statics.statics });
        c.send(msg);
        this.staticsSent.set(c, statics.sv);
        this.staticsBytesSent += msg.length;
      }
    }
    // Flow grid and perf counters: before the frame they belong to.
    if (flow) { const m = roundJson({ type: 'flow', flow }); for (const c of this.flowSubs) if (this.clients.has(c)) c.send(m); }
    if (perf) { const m = JSON.stringify({ type: 'perf', perf }); for (const c of this.perfSubs) if (this.clients.has(c)) c.send(m); }
    const s = roundJson({ type: 'frame', frame });
    for (const c of this.clients) c.send(s);
    this.lastFrameBytes = s.length;
    this.frameBytesSent += s.length * this.clients.size;
    this.broadcasts++;
  }

  step(req) {
    const out = this._compute(req);
    this._publish(out);
    return out.frame;
  }

  // Fixed 30 Hz clock. Slot k starts at T_k: the tick is computed then, and
  // its frame is broadcast at the end of the slot (T_k + 1/30 s) if it finished
  // early, so broadcasts never exceed 30 Hz and the sim never runs ahead of
  // real time. A tick slower than its slot is broadcast as soon as it is done,
  // and the next slot starts then (no catch-up burst; that time is dropped).
  _start() {
    const dt = 1000 / TICK_HZ;
    let slot = this.now();
    const runSlot = () => {
      this.timer = null;
      if (!this.core) return;
      const out = this._compute();
      const end = slot + dt;
      const publish = () => {
        this.timer = null;
        this._publish(out);
        slot = Math.max(end, this.now());
        this.timer = setTimeout(runSlot, Math.max(0, slot - this.now()));
      };
      const wait = end - this.now();
      if (wait > 0) this.timer = setTimeout(publish, wait);
      else publish();
    };
    this.timer = setTimeout(runSlot, 0);
  }

  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
