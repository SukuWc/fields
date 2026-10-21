// Settings registry (src/settings-registry.js): the server validates every
// room setting through it, a player setting is never a room command, the URL
// sync and its remote-mode exclusions follow it, and the settings panel in
// index.html holds exactly its controls (no defaults of its own).
import fs from 'node:fs';
import { SimCore } from '../src/host.js';
import { Room, validateRoomCommand, ROOM_COMMANDS as SERVER_ROOM_COMMANDS } from '../apps/server/room.js';
import {
  SETTINGS, ROOM_SETTINGS, PLAYER_SETTINGS, ROOM_COMMANDS, SIM_RES_MODES, DEFAULT_SIM_RES, DEFAULT_MAP_SIZE,
  urlSettingIds, roomCommandFor, roomStateValue, settingDefault, SUBSCRIPTION_IDS, MAX_WIND_MPS,
} from '../src/settings-registry.js';
import { SIM_RES_MODES as SIM_SIM_RES_MODES } from '../src/sim.js';
import { MAP_SIZES, MAP_SIZE_ORDER, DEFAULT_MAP_SIZE as MAP_DEFAULT, scenarioExtent, WALL_INSET_M } from '../src/map-size.js';
import { applySettingDefaults, PANEL_IDS } from '../src/settings-panel.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

// The validator as it was before the registry (apps/server/room.js at
// 1c7276b), kept here to show the registry-driven one answers the same.
const MAX_WIND_MPS_OLD = 30;
function oldValidateRoomCommand(c, core) {
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
        if (!Number.isFinite(c.speed) || c.speed < 0 || c.speed > MAX_WIND_MPS_OLD) return { error: 'wind speed must be 0..' + MAX_WIND_MPS_OLD + ' m/s' };
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

// A small room (50 x 100 m) so some scenarios do not fit.
const core = new SimCore({ mapW: 50, mapH: 100, simRes: '4' });

// 1. Same answers as before, over valid, invalid and odd commands.
{
  const vals = [undefined, null, true, false, 0, 1, -1, 3, 4, 12, 19, 20, 999, 45.5, 361, -90, 30, 30.01, 1000, 1e8, 1e9, NaN, Infinity, '', '1', '4', '4f', '2f', '2f34', 'auto', 'fixed', 'bogus', 'yes', '12', '3.0', {}, []];
  const fields = ['scenario', 'angle', 'speed', 'on', 'mode', 'tune', 'target', 'amr', 'boatEnergy'];
  // 'refine' came after the old validator (its own checks below).
  const types = [...ROOM_COMMANDS].filter((t) => t !== 'refine' && t !== 'sailWake').concat(['plot', 'spawnBoat', 'bogus']);
  const cmds = [];
  for (const type of types) {
    cmds.push({ type });
    for (const f of fields) for (const v of vals) cmds.push({ type, [f]: v });
    for (const a of [true, false, 'x', undefined]) for (const t of [null, undefined, 5000, 10, 'x', 2e8]) cmds.push({ type, tune: a, target: t });
    for (const a of [90, 'x', undefined, null]) for (const s of [4, -1, 31, undefined]) cmds.push({ type, angle: a, speed: s });
    for (const a of [true, 1, undefined]) for (const b of [false, 'no', undefined]) { cmds.push({ type, amr: a, boatEnergy: b }); cmds.push({ type, boatEnergy: b }); }
  }
  const diff = [];
  for (const c of cmds) {
    const a = JSON.stringify(oldValidateRoomCommand(c, core)), b = JSON.stringify(validateRoomCommand(c, core));
    if (a !== b) diff.push(JSON.stringify(c) + ' old ' + a + ' new ' + b);
  }
  check('registry validator answers exactly as the old room.js validator', diff.length === 0, `${cmds.length} commands` + (diff.length ? '; ' + diff.slice(0, 5).join(' | ') : ''));
  check('ROOM_COMMANDS: the registry\'s, the same set as before', SERVER_ROOM_COMMANDS === ROOM_COMMANDS && [...ROOM_COMMANDS].sort().join() === ['restart', 'wind', 'devMode', 'barrier', 'simRes', 'amrMode', 'refine', 'sailWake', 'cellBudget', 'options'].sort().join(), [...ROOM_COMMANDS].join());
}

// 2. Every room setting is validated by the server through the registry:
// a good value is accepted and lands in the room state, a bad one is
// refused, through a real Room.
const sent = [];
const client = { send: (s) => sent.push(JSON.parse(s)) };
const room = new Room('t', { lockstep: true, graceMs: 0 });
room.join(client);
room.message(client, { type: 'init', opts: { mapW: 50, mapH: 100, simRes: '4', scenario: 0 } });
let nextId = 1;
const command = (c) => {
  sent.length = 0;
  const id = nextId++;
  room.message(client, { type: 'command', id, c });
  const r = sent.find((m) => m.type === 'result' && m.id === id);
  const ev = sent.find((m) => m.type === 'event' && m.ev.type === 'room');
  return { r: r && r.r, room: ev && ev.ev.room };
};
const GOOD = { bool: (s) => !s.default, int: () => 2, number: (s) => (s.max !== undefined ? s.max : 45), enum: (s) => s.values.find((v) => v !== s.default) };
const BAD = { bool: () => 'yes', int: () => 'x', number: (s) => (s.max !== undefined ? s.max * 2 + 1 : NaN), enum: () => 'bogus' };
for (const s of ROOM_SETTINGS) {
  if (!s.command) { check(`${s.id}: no room command (set when the room is created)`, s.id === 'map_size'); continue; }
  const other = ROOM_SETTINGS.filter((o) => o !== s && o.command && o.command.type === s.command.type && o.command.required);
  const base = Object.fromEntries(other.map((o) => [o.id, o.default]));
  // Wind speed: below this room's mode ceiling (sim.js clamps to it).
  const good = s.id === 'windSpeed' ? 7 : GOOD[s.type](s);
  const ok = command(roomCommandFor({ ...base, [s.id]: good }));
  const stv = roomStateValue(s, ok.room && ok.room.settings);
  const want = s.normalize ? s.normalize(good) : good;
  const applied = s.state ? stv === want : (s.id === 'scenario_selector' && !!ok.room && ok.room.scenario.index === good);
  check(`${s.id}: ${JSON.stringify(good)} accepted (${s.command.type}.${s.command.field}) and in the room state`, !(ok.r && ok.r.error) && !!ok.room && applied, JSON.stringify(ok.r) + ' state ' + JSON.stringify(stv));
  const bad = BAD[s.type](s);
  const no = command(roomCommandFor({ ...base, [s.id]: bad }));
  check(`${s.id}: ${JSON.stringify(bad)} refused with an error, nothing broadcast`, !!(no.r && no.r.error) && !no.room, JSON.stringify(no.r));
  if (s.state) command(roomCommandFor({ ...base, [s.id]: s.default }));
}
{
  const v = (c) => JSON.stringify(validateRoomCommand(c, core));
  check('refine: needs maxLevel or boatRefineRadius; null resets; out of range refused',
    /needs/.test(v({ type: 'refine' })) && v({ type: 'refine', maxLevel: null }) === JSON.stringify({ c: { type: 'refine', maxLevel: null, boatRefineRadius: null } })
    && v({ type: 'refine', maxLevel: 3 }) === JSON.stringify({ c: { type: 'refine', maxLevel: 3, boatRefineRadius: null } })
    && /error/.test(v({ type: 'refine', maxLevel: 0 })) && /error/.test(v({ type: 'refine', maxLevel: 2.5 })) && /error/.test(v({ type: 'refine', boatRefineRadius: 0.1 })) && /error/.test(v({ type: 'refine', boatRefineRadius: 17 })));
}
check('the wind speed limit is the registry\'s', JSON.stringify(command({ type: 'wind', speed: MAX_WIND_MPS + 1 }).r) === JSON.stringify({ error: 'wind speed must be 0..' + MAX_WIND_MPS + ' m/s' }));
check('a scenario that does not fit the room is refused (room-dependent check)', /does not fit/.test((command({ type: 'restart', scenario: 12 }).r || {}).error || ''));

// 3. A player setting is never accepted as a room command.
for (const s of PLAYER_SETTINGS) {
  const v = s.type === 'bool' ? true : s.type === 'enum' ? s.values[0] : s.type === 'text' ? 'x' : 1;
  const before = JSON.stringify(room.core.roomState());
  const viaId = command({ type: s.id, on: v, value: v, mode: v });
  let thrown = false;
  try { roomCommandFor({ [s.id]: v }); } catch { thrown = true; }
  const own = s.command ? command({ type: s.command.type, [s.command.field]: s.type === 'enum' ? 0 : v }) : null;
  const ok = thrown && !ROOM_COMMANDS.has(s.id) && !!(viaId.r && viaId.r.error) && !viaId.room
    && (!s.command || (!ROOM_COMMANDS.has(s.command.type) && !own.room && !(own.r && own.r.error)))
    && JSON.stringify(room.core.roomState()) === before;
  check(`${s.id}: never a room command (refused by id${s.command ? '; its ' + s.command.type + ' command stays per client' : ''}), room unchanged`, ok, JSON.stringify(viaId.r));
}
check('the per-client subscriptions are player settings', Object.keys(SUBSCRIPTION_IDS).sort().join() === 'field,flow,perf' && Object.values(SUBSCRIPTION_IDS).every((id) => PLAYER_SETTINGS.some((s) => s.id === id)), JSON.stringify(SUBSCRIPTION_IDS));

// The settings panel in index.html: each control's id, tag, markup and the
// panel it sits in.
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const spanOf = (id) => {
  const i = html.indexOf('<div id="' + id + '"');
  const re = /<div\b|<\/div>/g;
  re.lastIndex = i;
  let d = 0, m;
  while ((m = re.exec(html))) { d += m[0] === '</div>' ? -1 : 1; if (d === 0) return [i, re.lastIndex]; }
  return [i, html.length];
};
const panels = { settings: spanOf('settings'), player: spanOf(PANEL_IDS.player), room: spanOf(PANEL_IDS.room) };
const SKIP = new Set(['button', 'submit', 'reset', 'image', 'file', 'hidden']);
const controls = [];
for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
  const attrs = m[2];
  const id = (attrs.match(/\bid="([^"]*)"/) || [])[1];
  const type = (attrs.match(/\btype="([^"]*)"/) || [])[1] || (m[1] === 'input' ? 'text' : '');
  if (!id || (m[1] === 'input' && SKIP.has(type))) continue;
  const at = m.index;
  if (at < panels.settings[0] || at > panels.settings[1]) continue;
  const inside = (p) => at > panels[p][0] && at < panels[p][1];
  const panel = inside('player') ? 'player' : inside('room') ? 'room' : null;
  let options = null;
  if (m[1] === 'select') {
    const body = html.slice(at, html.indexOf('</select>', at));
    options = [...body.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map((o) => ({ value: (o[1].match(/value="([^"]*)"/) || [])[1] ?? o[2], text: o[2], selected: /\bselected\b/.test(o[1]) }));
  }
  controls.push({ id, tag: m[1].toUpperCase(), type, attrs, panel, options });
}

// 4. URL sync: the registry's ids, minus the room settings in remote mode;
// the same controls as before (all of #settings; remote: not #admin_panel).
{
  const all = controls.map((c) => c.id);
  const local = urlSettingIds({ remote: false }), remote = urlSettingIds({ remote: true });
  check('URL settings (local, worker): every control on the panel, nothing else', local.join() === all.join(), local.length + ' ids');
  check('URL settings (remote): exactly the controls outside the room panel (the old #admin_panel exclusion)', remote.join() === controls.filter((c) => c.panel !== 'room').map((c) => c.id).join());
  const left = all.filter((id) => !remote.includes(id));
  check('remote mode leaves exactly the room settings out of the URL', left.join() === ROOM_SETTINGS.map((s) => s.id).join(), left.join());
  check('no player setting is left out of the URL', PLAYER_SETTINGS.every((s) => remote.includes(s.id) && local.includes(s.id)));
}

// 5. Panel contents match the registry: the same controls, in order, in the
// registry's panel; no defaults or ranges in the markup; the select options
// are the allowed values.
{
  const byPanel = (p) => controls.filter((c) => c.panel === p).map((c) => c.id).join();
  check('the Player panel holds exactly the player-panel settings, in order', byPanel('player') === SETTINGS.filter((s) => s.panel === 'player').map((s) => s.id).join(), byPanel('player'));
  check('the Room settings panel holds exactly the room-panel settings, in order', byPanel('room') === SETTINGS.filter((s) => s.panel === 'room').map((s) => s.id).join(), byPanel('room'));
  check('every control is in one of the two panels', controls.every((c) => c.panel));
  check('room settings sit on the room panel, player settings on the player panel', SETTINGS.every((s) => s.panel === s.scope));
  const own = controls.filter((c) => /\s(value|min|max)="|\schecked\b/.test(' ' + c.attrs) || (c.options && c.options.some((o) => o.selected)));
  check('the markup carries no defaults or ranges of its own (value, checked, selected, min, max)', own.length === 0, own.map((c) => c.id).join());
  for (const s of SETTINGS.filter((x) => x.type === 'enum')) {
    const c = controls.find((x) => x.id === s.id);
    const vals = c.options.map((o) => o.value);
    const want = s.id === 'map_size' ? MAP_SIZE_ORDER : s.values;
    check(`${s.id}: the options are the allowed values`, [...vals].sort().join() === [...want].sort().join() && vals.includes(String(s.default)), vals.join());
  }
  check('types match the controls (checkbox = bool, select = enum, number / range = number / int, text)', SETTINGS.every((s) => {
    const c = controls.find((x) => x.id === s.id);
    return s.type === 'bool' ? c.type === 'checkbox' : s.type === 'enum' ? c.tag === 'SELECT' : s.type === 'text' ? c.type === 'text' : (c.type === 'number' || c.type === 'range');
  }));
}

// 6. Defaults from one place.
check('simRes default: the registry\'s, for every map size; sim.js modes are the registry\'s', settingDefault('simRes') === DEFAULT_SIM_RES && Object.values(MAP_SIZES).every((m) => m.simRes === DEFAULT_SIM_RES) && SIM_SIM_RES_MODES === SIM_RES_MODES && !!SIM_RES_MODES[DEFAULT_SIM_RES]);
check('map size default: the registry\'s', MAP_DEFAULT === DEFAULT_MAP_SIZE && settingDefault('map_size') === DEFAULT_MAP_SIZE && !!MAP_SIZES[DEFAULT_MAP_SIZE]);
{
  const st = core.roomState().settings;
  const off = ROOM_SETTINGS.filter((s) => s.state && s.id !== 'simRes' && roomStateValue(s, st) !== s.default);
  check('a new SimCore starts with the registry defaults (wind, dev mode, options, layout, budget)', off.length === 0, off.map((s) => s.id + '=' + JSON.stringify(roomStateValue(s, st))).join());
  const r = new Room('d', { lockstep: true, graceMs: 0 });
  const c2 = { send() {} };
  r.join(c2);
  r.message(c2, { type: 'init', opts: { mapW: 50, mapH: 100 } });
  check('a server room created without options gets the registry\'s simRes and wind', r.core.settings.simRes === DEFAULT_SIM_RES && r.core.settings.wind.angle === settingDefault('windAngle') && r.core.settings.wind.speed === settingDefault('windSpeed'), JSON.stringify(r.core.settings));
  r.leave(c2);
}

// 7. applySettingDefaults on a stand-in DOM built from the markup: every
// control gets the registry default, the ranges come from the registry.
{
  const els = new Map();
  for (const c of controls) {
    const el = { id: c.id, tagName: c.tag, type: c.tag === 'SELECT' ? 'select-one' : c.type, value: '', defaultValue: '', checked: false, defaultChecked: false,
      closest: (sel) => (sel === '#' + PANEL_IDS[c.panel] ? {} : null) };
    if (c.options) {
      el.options = c.options.map((o) => ({ value: o.value, textContent: o.text, defaultSelected: false }));
      delete el.value;
      Object.defineProperty(el, 'value', { get() { const o = this.options.find((x) => x.defaultSelected); return this._v ?? (o ? o.value : this.options[0].value); }, set(v) { this._v = v; } });
    }
    els.set(c.id, el);
  }
  const warn = console.warn; console.warn = () => {};
  const problems = applySettingDefaults({ getElementById: (id) => els.get(id) || null });
  console.warn = warn;
  check('applySettingDefaults: every registry setting has its control, in its panel', problems.length === 0, problems.join('; '));
  const wrong = SETTINGS.filter((s) => {
    const el = els.get(s.id);
    if (s.type === 'bool') return el.checked !== s.default || el.defaultChecked !== s.default;
    const want = s.default === null ? '' : String(s.default);
    return el.value !== want || (el.options ? !el.options.find((o) => o.value === want).defaultSelected : el.defaultValue !== want);
  });
  check('applySettingDefaults: each control holds the registry default', wrong.length === 0, wrong.map((s) => s.id).join());
  const e = (id) => els.get(id);
  check('applySettingDefaults: number ranges from the registry (ui hints where they differ)', e('windSpeed').max === '15' && e('windSpeed').min === '0' && e('tracerLife').min === '0.5' && e('contrastSlider').max === '10' && e('cellBudget').min === '1000' && e('cellBudget').max === undefined && e('scenario_selector').max === '20');
  const opt = e('simRes').options.find((o) => o.value === DEFAULT_SIM_RES);
  check('the default simulation resolution option says it is the default', /\(default, /.test(opt.textContent), opt.textContent);
}

room.leave(client);
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all settings-registry checks passed');
process.exit(0);
