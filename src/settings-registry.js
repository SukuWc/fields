// Settings registry: every control on the settings panel (#settings), in
// panel order, with
//   id         element id, also its URL query key (url-settings.js)
//   scope      'room': a room-wide setting, sent as a validated room command
//              (apps/server/room.js ROOM_COMMANDS / validateRoomCommand,
//              broadcast to everyone in a server room);
//              'player': this page only, or a per-client subscription
//   panel      'room' (#admin_panel, Room settings) or 'player'
//              (#player_panel, Player)
//   type       'bool' | 'number' | 'int' | 'enum' | 'text'
//   default    the control's default (applied to the page by
//              settings-panel.js; nothing else in the markup)
//   validation min / max (inclusive), nullable, values (enum)
//   command    room settings: { type, field } of the room command carrying
//              it; required: the command needs this field; key: present
//              whenever the key is (even undefined), else when defined.
//              Player settings
//              may name a per-client command (plot).
//   state      room settings: path of the value in SimCore.settings /
//              roomState().settings (remote mode shows the room's values)
//   subscription  per-client stream it switches: 'flow' | 'field' | 'perf'
//   url        false: never written to the URL (default true; remote mode
//              leaves every room setting out: the room has its own values)
//   ui         number inputs: { min, max } spinner hints when they differ
//              from the validation range (null: no attribute); the wind
//              speed max then follows the mode (controls.js setWindCeiling)
//   devModeDisabled  disabled while dev mode is on (no fluid)
//   markDefault  the default option's label says so ("(default, ...)")
//
// No DOM here: the server (room.js) and the sim (host.js) read it too.
// Its only import is sim-modes.js, which imports nothing.

// Simulation resolution modes, their default and wind ceilings: sim-modes.js
// (no imports either). The simRes setting's values and default come from
// there: the panel, every map size (map-size.js), the server's new rooms.
import { SIM_RES_MODES, DEFAULT_SIM_RES, windCeilingMps, DEFAULT_MAX_LEVEL, DEFAULT_BOAT_REFINE_RADIUS } from './sim-modes.js';
export { SIM_RES_MODES, DEFAULT_SIM_RES };
export const DEFAULT_MAP_SIZE = '100x200';
export const MAX_WIND_MPS = 30;

export const SETTINGS = [
  // Player panel.
  { id: 'boat_name', scope: 'player', panel: 'player', type: 'text', default: '' },
  { id: 'show_field', scope: 'player', panel: 'player', type: 'bool', default: true, subscription: 'flow' },
  { id: 'tracers', scope: 'player', panel: 'player', type: 'number', default: null, nullable: true, min: 10, max: 20000 },
  { id: 'tracerLife', scope: 'player', panel: 'player', type: 'number', default: 6, min: 0.5, max: 30 },
  { id: 'tracerTail', scope: 'player', panel: 'player', type: 'number', default: 1.5, min: 0, max: 10 },
  { id: 'boat_trails', scope: 'player', panel: 'player', type: 'bool', default: true },
  { id: 'trailInterval', scope: 'player', panel: 'player', type: 'number', default: 1, min: 0.1, max: 30 },
  { id: 'trailDuration', scope: 'player', panel: 'player', type: 'number', default: 60, min: 1, max: 1200 },
  { id: 'trailSize', scope: 'player', panel: 'player', type: 'number', default: 0.4, min: 0.05, max: 5 },
  { id: 'ghost', scope: 'player', panel: 'player', type: 'bool', default: false },
  { id: 'ghostAhead', scope: 'player', panel: 'player', type: 'number', default: 2, min: 0, max: 30 },
  { id: 'field_plane', scope: 'player', panel: 'player', type: 'bool', default: true, subscription: 'field' },
  { id: 'show_forces', scope: 'player', panel: 'player', type: 'bool', default: false },
  { id: 'camera_follow', scope: 'player', panel: 'player', type: 'bool', default: false },
  { id: 'perf', scope: 'player', panel: 'player', type: 'bool', default: false, subscription: 'perf' },
  // Default off; touch-controls.js turns it on for phones and touch screens.
  { id: 'touch', scope: 'player', panel: 'player', type: 'bool', default: false },
  // The plot shapes only this page's field messages ('plot' is a per-client
  // command, never a room command). The URL holds the option text.
  { id: 'plotSelect', scope: 'player', panel: 'player', type: 'enum', default: 'Plot speed', values: ['Plot density', 'Plot x velocity', 'Plot y velocity', 'Plot speed', 'Plot curl'], command: { type: 'plot', field: 'plotType' }, devModeDisabled: true },
  { id: 'contrastSlider', scope: 'player', panel: 'player', type: 'number', default: 0, min: -10, max: 10, command: { type: 'plot', field: 'contrastExp' }, devModeDisabled: true },

  // Room settings panel.
  // The scenario's existence and fit depend on the room: checks.scenario.
  { id: 'scenario_selector', scope: 'room', panel: 'room', type: 'int', default: 0, min: 0, coerce: true, check: 'scenario', ui: { min: 0, max: 20 },
    command: { type: 'restart', field: 'scenario', required: true }, invalid: (v) => 'no scenario ' + v },
  { id: 'windAngle', scope: 'room', panel: 'room', type: 'number', default: 90, ui: { min: 0, max: 360 },
    command: { type: 'wind', field: 'angle' }, state: 'wind.angle', normalize: (v) => ((v % 360) + 360) % 360, invalid: () => 'bad wind angle' },
  { id: 'windSpeed', scope: 'room', panel: 'room', type: 'number', default: 4.5, min: 0, max: MAX_WIND_MPS, ui: { min: 0, max: windCeilingMps(DEFAULT_SIM_RES) },
    command: { type: 'wind', field: 'speed' }, state: 'wind.speed', invalid: () => 'wind speed must be 0..' + MAX_WIND_MPS + ' m/s' },
  { id: 'devmode', scope: 'room', panel: 'room', type: 'bool', default: false, command: { type: 'devMode', field: 'on', required: true }, state: 'devMode' },
  { id: 'amr', scope: 'room', panel: 'room', type: 'bool', default: true, command: { type: 'options', field: 'amr', key: true }, state: 'amr', devModeDisabled: true },
  { id: 'barrier', scope: 'room', panel: 'room', type: 'bool', default: false, command: { type: 'barrier', field: 'on', required: true }, state: 'barrier', devModeDisabled: true },
  { id: 'boat_energy', scope: 'room', panel: 'room', type: 'bool', default: true, command: { type: 'options', field: 'boatEnergy', key: true }, state: 'boatEnergy', devModeDisabled: true },
  { id: 'simRes', scope: 'room', panel: 'room', type: 'enum', default: DEFAULT_SIM_RES, values: Object.keys(SIM_RES_MODES), markDefault: true,
    command: { type: 'simRes', field: 'mode', required: true }, state: 'simRes', invalid: (v) => 'unknown simRes ' + v },
  { id: 'amrMode', scope: 'room', panel: 'room', type: 'enum', default: 'auto', values: ['auto', 'fixed'],
    command: { type: 'amrMode', field: 'mode', required: true }, state: 'amrMode', invalid: () => 'amrMode must be auto or fixed' },
  // Sail → field momentum: multiple of the boat's own sail impulse put into
  // the lattice (boat.js SAIL_WAKE_GAIN, 16; sim.js sailEfficiency). 0 = no
  // wake; higher = deeper wake (32 reaches |u| ≈ 0.49 at wind 25).
  { id: 'sailWakeGain', scope: 'room', panel: 'room', type: 'number', default: 16, min: 0, max: 64,
    command: { type: 'sailWake', field: 'gain', required: true }, state: 'sailWakeGain', invalid: () => 'sailWake gain must be 0..64', devModeDisabled: true },
  // Boat refinement stack (domainTrack amrParams). Default 3 levels and a
  // 3 m finest disk (sim-modes.js). Empty = the mode's full stack (2f 4,
  // 4f 5, 1 m 3, x2 4, x4 5) / the level's own disk (2 m on a full stack).
  // Clamped per mode by the engine. Restarts.
  { id: 'maxLevel', scope: 'room', panel: 'room', type: 'int', default: DEFAULT_MAX_LEVEL, nullable: true, min: 1, max: 5,
    command: { type: 'refine', field: 'maxLevel' }, state: 'refine.maxLevel', invalid: () => 'maxLevel must be 1..5 or null', devModeDisabled: true },
  { id: 'boatRefineRadius', scope: 'room', panel: 'room', type: 'number', default: DEFAULT_BOAT_REFINE_RADIUS, nullable: true, min: 0.5, max: 16,
    command: { type: 'refine', field: 'boatRefineRadius' }, state: 'refine.boatRefineRadius', invalid: () => 'boatRefineRadius must be 0.5..16 m or null', devModeDisabled: true },
  // Set when the room is created (the creator's init options); no command.
  // Values: map-size.js MAP_SIZES.
  { id: 'map_size', scope: 'room', panel: 'room', type: 'enum', default: DEFAULT_MAP_SIZE },
  { id: 'cellBudgetTune', scope: 'room', panel: 'room', type: 'bool', default: true, command: { type: 'cellBudget', field: 'tune', required: true }, state: 'cellBudget.tune' },
  // Empty = the grid's default target (null).
  { id: 'cellBudget', scope: 'room', panel: 'room', type: 'number', default: null, nullable: true, min: 1000, max: 1e8, ui: { min: 1000, max: null },
    command: { type: 'cellBudget', field: 'target' }, state: 'cellBudget.target', invalid: () => 'cellBudget target must be 1000..1e8 or null' },
];

export const SETTING_BY_ID = new Map(SETTINGS.map((s) => [s.id, s]));
export const ROOM_SETTINGS = SETTINGS.filter((s) => s.scope === 'room');
export const PLAYER_SETTINGS = SETTINGS.filter((s) => s.scope === 'player');

export function setting(id) {
  const s = SETTING_BY_ID.get(id);
  if (!s) throw new Error('unknown setting ' + id);
  return s;
}
export function settingDefault(id) { return setting(id).default; }

// Room command types and the settings each carries, in panel order.
export const ROOM_COMMAND_FIELDS = new Map();
for (const s of ROOM_SETTINGS) {
  if (!s.command) continue;
  if (!ROOM_COMMAND_FIELDS.has(s.command.type)) ROOM_COMMAND_FIELDS.set(s.command.type, []);
  ROOM_COMMAND_FIELDS.get(s.command.type).push(s);
}
export const ROOM_COMMANDS = new Set(ROOM_COMMAND_FIELDS.keys());
export function isRoomCommand(type) { return ROOM_COMMANDS.has(type); }

// One value against its setting: { v } (normalised) or { error }.
export function validateSettingValue(s, raw) {
  const field = s.command ? s.command.field : s.id;
  const bad = () => ({ error: s.invalid ? s.invalid(raw) : (s.command && s.command.required ? s.command.type + ' needs ' + field + ': true | false' : field + ' must be true | false') });
  if (s.nullable && (raw === null || raw === undefined)) return { v: null };
  switch (s.type) {
    case 'bool':
      return typeof raw === 'boolean' ? { v: raw } : bad();
    case 'int': case 'number': {
      const v = s.coerce ? Number(raw) : raw;
      if (s.type === 'int' ? !Number.isInteger(v) : !Number.isFinite(v)) return bad();
      if ((s.min !== undefined && v < s.min) || (s.max !== undefined && v > s.max)) return bad();
      return { v: s.normalize ? s.normalize(v) : v };
    }
    case 'enum':
      return s.values && s.values.some((x) => x === raw || (typeof raw === 'number' && x === String(raw))) ? { v: raw } : bad();
    case 'text':
      return typeof raw === 'string' ? { v: raw } : bad();
    default:
      return bad();
  }
}

// A room command checked against the registry: { c } (normalised) or
// { error }. checks: room-dependent checks by name (check: 'scenario'),
// each (value) → error string or null.
export function validateRoomSettingCommand(c, checks = {}) {
  const fields = c && ROOM_COMMAND_FIELDS.get(c.type);
  if (!fields) return { error: 'unknown command ' + (c && c.type) };
  const out = { type: c.type };
  for (const s of fields) {
    const f = s.command.field;
    const present = s.command.key || s.nullable ? f in c : c[f] !== undefined;
    if (!present) {
      if (s.command.required) {
        const r = validateSettingValue(s, c[f]);
        if (r.error) return r;
      }
      if (s.nullable) out[f] = null;
      continue;
    }
    const r = validateSettingValue(s, c[f]);
    if (r.error) return r;
    if (s.check && checks[s.check]) {
      const e = checks[s.check](r.v, c[f]);
      if (e) return { error: e };
    }
    out[f] = r.v;
  }
  // Commands whose fields are all optional need at least one of them.
  if (!fields.some((s) => s.command.required)) {
    const given = fields.filter((s) => (s.nullable ? s.command.field in c : out[s.command.field] !== undefined));
    if (!given.length) return { error: c.type + ' needs ' + fields.map((s) => s.command.field).join(' or ') };
  }
  return { c: out };
}

// The room command for edited settings: values { id: value } of settings
// sharing one command (e.g. cellBudgetTune + cellBudget).
export function roomCommandFor(values) {
  let out = null;
  for (const [id, v] of Object.entries(values)) {
    const s = setting(id);
    if (s.scope !== 'room' || !s.command) throw new Error(id + ' is not sent as a room command');
    if (out && out.type !== s.command.type) throw new Error('settings of different commands: ' + Object.keys(values).join(', '));
    out = out || { type: s.command.type };
    out[s.command.field] = v;
  }
  return out;
}

// A room setting's value in SimCore.settings (roomState().settings).
export function roomStateValue(s, settings) {
  if (!s.state || !settings) return undefined;
  let v = settings;
  for (const k of s.state.split('.')) { if (v === null || v === undefined) return undefined; v = v[k]; }
  return v;
}

// Ids kept in sync with the URL: every setting, minus the room settings in
// remote mode (the room's own values win there).
export function urlSettingIds({ remote = false } = {}) {
  return SETTINGS.filter((s) => s.url !== false && !(remote && s.scope === 'room')).map((s) => s.id);
}

// Per-client streams and the player setting that switches each.
export const SUBSCRIPTION_IDS = Object.fromEntries(SETTINGS.filter((s) => s.subscription).map((s) => [s.subscription, s.id]));

export const DEV_MODE_DISABLED = SETTINGS.filter((s) => s.devModeDisabled).map((s) => s.id);
