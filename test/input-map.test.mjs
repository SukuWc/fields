// Input mapping (Settings → Player → Input mapping): which boat the keyboard
// and each gamepad drive. Key layouts per keyboard target, pad routing by pad
// index, one boat = everything on boat 1, persistence helpers, and the
// commands reaching the right boat in a local game and a server room.
import './dom-stub.mjs';
const C = await import('../src/controls.js');
const { inputMapPref, setupInputMap } = await import('../src/input-map.js');
const { readPlayerPref, writePlayerPref, PREFS_KEY, EXTRA_PREF_KEYS } = await import('../src/player-prefs.js');
const { LocalHost } = await import('../src/host.js');
const { WebSocket } = await import('ws');
const { startServer } = await import('../apps/server/index.js');
const { RemoteHost } = await import('../src/remote-host.js');

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const boatsOf = (list) => [...new Set(list.map((b) => b.command.boat))].sort().join();
const keysOf = (list) => list.map((b) => b.activation_key).sort((a, b) => a - b).join();
const ONE_BOAT_KEYS = '13,32,37,38,39,40,69,81,88';

// 1. Key layouts (pure).
{
  check('defaults: Split keyboard, pad 1 → boat 1, pad 2 → boat 2', JSON.stringify(C.inputMap()) === '{"keyboard":"split","pads":["boat1","boat2"]}');
  check('no boat bound: no keys', C.keyBindings(0, 'boat2').length === 0);
  const one = C.keyBindings(1, 'boat2');
  check('one boat: the one-boat layout drives boat 1 whatever the keyboard target', boatsOf(one) === '0' && keysOf(one) === ONE_BOAT_KEYS && boatsOf(C.keyBindings(1, 'split')) === '0');
  const split = C.keyBindings(2, 'split');
  check('two boats, Split: today\'s two-player layout (P1 arrows / Space / Enter / , . /, P2 A D W S F G Q E X)',
    keysOf(split.filter((b) => b.command.boat === 0)) === '13,32,37,38,39,40,188,190,191' && keysOf(split.filter((b) => b.command.boat === 1)) === '65,68,69,70,71,81,83,87,88');
  const k2 = C.keyBindings(2, 'boat2');
  check('two boats, keyboard → boat 2: the full one-boat layout, every command on boat 2 only', boatsOf(k2) === '1' && keysOf(k2) === ONE_BOAT_KEYS);
  const k1 = C.keyBindings(2, 'boat1');
  check('two boats, keyboard → boat 1: the full layout on boat 1 only', boatsOf(k1) === '0' && keysOf(k1) === ONE_BOAT_KEYS);
  check('W / S zoom unless Split gives them to player 2', C.zoomKeyStep(C.ZOOM_IN_KEY, 1) === -2 && C.zoomKeyStep(C.ZOOM_IN_KEY, 2) === 0);
  check('normalizeInputMap drops unknown values', JSON.stringify(C.normalizeInputMap({ keyboard: 'boat3', pads: ['boat2', 'x'] })) === '{"keyboard":"split","pads":["boat2","boat2"]}');
  check('targetBoat: none with 0 boats, boat 1 with one, mapped with two', C.targetBoat('boat2', 0) === -1 && C.targetBoat('boat2', 1) === 0 && C.targetBoat('boat2', 2) === 1 && C.targetBoat('boat1', 2) === 0);
}

// 2. Routing through the controls module state (keyboard keys, pad actions).
{
  const sent = [];
  C.setInputHost({ command: (c) => { sent.push(c); return Promise.resolve(true); } });
  C.setStickyAutopilot(false);
  C.bindKeys(2);
  C.setInputMap({ keyboard: 'boat2' });
  C.setVirtualKey(32, true); C.setVirtualKey(32, false);
  C.setVirtualKey(37, true);
  const held = C.heldCommands();
  C.setVirtualKey(37, false);
  check('keyboard → boat 2: Space toggles boat 2\'s autopilot only', JSON.stringify(sent) === '[{"type":"autopilot","boat":1}]', JSON.stringify(sent));
  check('keyboard → boat 2: held Left helms boat 2 only', JSON.stringify(held) === '[{"type":"helm","boat":1,"dir":-1}]', JSON.stringify(held));
  sent.length = 0;
  C.setPadAction(0, 'tack', true); C.setPadAction(0, 'tack', false);
  C.setPadAction(1, 'depower', true);
  check('pad 1 → boat 1 and pad 2 → boat 2 (one-shots)', JSON.stringify(sent) === '[{"type":"tack","boat":0},{"type":"depower","boat":1}]', JSON.stringify(sent));
  C.setPadAction(0, 'left', true); C.setPadAction(1, 'up', true);
  check('pad held actions: pad 1 helms boat 1, pad 2 trims boat 2\'s heading target', JSON.stringify(C.heldCommands()) === '[{"type":"helm","boat":0,"dir":-1},{"type":"headingTarget","boat":1,"dir":-1}]', JSON.stringify(C.heldCommands()));
  C.setPadAction(0, 'right', true);
  check('opposite stick directions cancel (like opposite keys)', !C.heldCommands().some((c) => c.boat === 0 && c.type === 'helm'));
  C.setPadAction(0, 'right', false); C.setPadAction(0, 'left', false); C.setPadAction(1, 'up', false);
  sent.length = 0;
  C.setInputMap({ keyboard: 'split', pads: ['boat2', 'boat1'] });
  C.setPadAction(0, 'autopilot', true); C.setPadAction(1, 'autopilot', true);
  check('swapped pads: pad 1 → boat 2, pad 2 → boat 1', JSON.stringify(sent) === '[{"type":"autopilot","boat":1},{"type":"autopilot","boat":0}]', JSON.stringify(sent));
  C.setPadAction(0, 'autopilot', false); C.setPadAction(1, 'autopilot', false);
  C.setInputMap({ keyboard: 'boat1', pads: ['boat2', 'boat2'] });
  C.setPadAction(0, 'down', true); C.setVirtualKey(40, true);
  check('keyboard and a pad on the same boat send each held command once', JSON.stringify(C.heldCommands()) === '[{"type":"headingTarget","boat":0,"dir":1},{"type":"headingTarget","boat":1,"dir":1}]', JSON.stringify(C.heldCommands()));
  C.setInputMap({ keyboard: 'boat1', pads: ['boat1', 'boat2'] });
  check('...and once when both are on boat 1', JSON.stringify(C.heldCommands()) === '[{"type":"headingTarget","boat":0,"dir":1}]', JSON.stringify(C.heldCommands()));
  C.setPadAction(0, 'down', false); C.setVirtualKey(40, false);
  sent.length = 0;
  C.setInputMap({ keyboard: 'boat2', pads: ['boat2', 'boat2'] });
  C.bindKeys(1);
  C.setPadAction(0, 'tack', true); C.setPadAction(0, 'tack', false);
  C.setVirtualKey(13, true); C.setVirtualKey(13, false);
  check('one boat bound: pads and keyboard mapped to boat 2 drive boat 1', JSON.stringify(sent) === '[{"type":"tack","boat":0},{"type":"tack","boat":0}]', JSON.stringify(sent));
  sent.length = 0;
  C.bindKeys(0);
  C.setPadAction(0, 'tack', true); C.setPadAction(0, 'tack', false); C.setPadAction(1, 'left', true);
  check('spectating (no boat bound): pads send nothing', sent.length === 0 && C.heldCommands().length === 0);
  C.setPadAction(1, 'left', false);
  let seen = null;
  C.onBindingChange((n) => { seen = n; });
  C.bindKeys(2);
  check('binding changes are reported (the hint hides with two boats)', seen === 2 && C.boundBoats() === 2);
  C.setInputMap(C.DEFAULT_INPUT_MAP);
  C.setStickyAutopilot(true);
}

// 3. Persistence: saved with the player prefs, only when not the default.
{
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  storage.setItem(PREFS_KEY, JSON.stringify({ vibrate: false }));
  check('input_map is a kept player-pref key', EXTRA_PREF_KEYS.includes('input_map'));
  check('the default mapping is not saved', inputMapPref(C.DEFAULT_INPUT_MAP) === undefined);
  writePlayerPref('input_map', inputMapPref({ keyboard: 'boat2', pads: ['boat1', 'boat1'] }), storage);
  const saved = JSON.parse(storage.getItem(PREFS_KEY));
  check('a changed mapping is saved next to the other player prefs', saved.vibrate === false && JSON.stringify(saved.input_map) === '{"keyboard":"boat2","pads":["boat1","boat1"]}', storage.getItem(PREFS_KEY));
  check('and read back', JSON.stringify(C.normalizeInputMap(readPlayerPref('input_map', storage))) === '{"keyboard":"boat2","pads":["boat1","boat1"]}');
  writePlayerPref('input_map', inputMapPref(C.DEFAULT_INPUT_MAP), storage);
  check('back to the default removes the key', storage.getItem(PREFS_KEY) === '{"vibrate":false}', storage.getItem(PREFS_KEY));
}

// 4. The radios (stand-in DOM): editable with one boat, the choice is saved
// and only takes effect once a second boat is bound.
{
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const mk = (name, value) => ({ type: 'radio', name, value, checked: false, disabled: false });
  const radios = [mk('input_map_keyboard', 'split'), mk('input_map_keyboard', 'boat1'), mk('input_map_keyboard', 'boat2'),
    mk('input_map_pad1', 'boat1'), mk('input_map_pad1', 'boat2'), mk('input_map_pad2', 'boat1'), mk('input_map_pad2', 'boat2')];
  const classes = new Set();
  let onChange = null;
  const group = {
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    querySelectorAll: (sel) => { const m = sel.match(/name="([^"]+)"/); return m ? radios.filter((r) => r.name === m[1]) : []; },
    addEventListener: (t, fn) => { if (t === 'change') onChange = fn; },
  };
  const hint = { hidden: false };
  const doc = { getElementById: (id) => (id === 'input_map_group' ? group : id === 'input_map_hint' ? hint : null) };
  const sent = [];
  C.setInputHost({ command: (c) => { sent.push(c); return Promise.resolve(true); } });
  C.setInputMap(C.DEFAULT_INPUT_MAP);
  C.bindKeys(1);
  setupInputMap(doc, storage);
  const pick = (name, value) => { for (const r of radios.filter((x) => x.name === name)) r.checked = r.value === value; onChange({ target: radios.find((r) => r.name === name && r.value === value) }); };
  check('one boat: the radios stay editable, the hint says when the mapping applies', radios.every((r) => !r.disabled) && hint.hidden === false && classes.has('single'));
  pick('input_map_keyboard', 'boat2');
  pick('input_map_pad1', 'boat2');
  check('one boat: a changed choice is saved', JSON.stringify(JSON.parse(storage.getItem(PREFS_KEY)).input_map) === '{"keyboard":"boat2","pads":["boat2","boat2"]}', storage.getItem(PREFS_KEY));
  C.setVirtualKey(13, true); C.setVirtualKey(13, false);
  C.setPadAction(0, 'tack', true); C.setPadAction(0, 'tack', false);
  check('one boat: keyboard and pad 1 still drive the one boat', JSON.stringify(sent) === '[{"type":"tack","boat":0},{"type":"tack","boat":0}]', JSON.stringify(sent));
  sent.length = 0;
  C.bindKeys(2);
  C.setVirtualKey(13, true); C.setVirtualKey(13, false);
  C.setPadAction(0, 'tack', true); C.setPadAction(0, 'tack', false);
  check('second boat bound: the saved mapping applies (keyboard and pad 1 → boat 2), hint hidden', JSON.stringify(sent) === '[{"type":"tack","boat":1},{"type":"tack","boat":1}]' && hint.hidden === true && !classes.has('single'), JSON.stringify(sent));
  C.bindKeys(0);
  C.setInputMap(C.DEFAULT_INPUT_MAP);
}

const opts = { mapW: 100, mapH: 200, simRes: '4f' };
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };
const tex = () => ({ image: { data: new Uint8Array(0) } });
console.log = () => {};

// 5. Local game with two boats: keyboard → boat 2 reaches only the second boat.
{
  const h = new LocalHost({ ...opts, texture: tex() });
  h.commandSync({ type: 'restart', scenario: 0 });
  for (let t = 0; t < 3; t++) h.tick({ dt: 1 / 30, held: [], present: true, view });
  h.commandSync({ type: 'spawnBoat', name: 'Two' });
  const [b0, b1] = h.core.sim.players;
  C.setInputHost({ command: (c) => h.commandSync(c) });
  C.bindKeys(2);
  C.setInputMap({ keyboard: 'boat2' });
  const k0 = [b0.autopilot_heading_target, b1.autopilot_heading_target];
  C.setVirtualKey(13, true); C.setVirtualKey(13, false);
  const k1 = [b0.autopilot_heading_target, b1.autopilot_heading_target];
  check('local: keyboard → boat 2, Enter tacks only the second boat', k1[1] === -k0[1] && k0[1] !== 0 && k1[0] === k0[0], JSON.stringify([k0, k1]));
  C.setInputMap({ keyboard: 'split', pads: ['boat1', 'boat2'] });
  const t0 = [b0.autopilot_heading_target, b1.autopilot_heading_target];
  if (!b0.autopilot_enabled) C.setPadAction(0, 'autopilot', true); C.setPadAction(0, 'autopilot', false);
  if (!b1.autopilot_enabled) C.setPadAction(1, 'autopilot', true); C.setPadAction(1, 'autopilot', false);
  for (let t = 0; t < 2; t++) h.tick({ dt: 1 / 30, held: C.heldCommands(), present: false, view });
  const a0 = b0.autopilot_heading_target, a1 = b1.autopilot_heading_target;
  C.setPadAction(1, 'tack', true); C.setPadAction(1, 'tack', false);
  check('local: pad 2 tacks the second boat only', b1.autopilot_heading_target === -a1 && b0.autopilot_heading_target === a0 && a1 !== 0, JSON.stringify([t0, a0, a1, b0.autopilot_heading_target, b1.autopilot_heading_target]));
  const before0 = b0.autopilot_heading_target, before1 = b1.autopilot_heading_target;
  C.setPadAction(0, 'down', true);
  for (let t = 0; t < 5; t++) h.tick({ dt: 1 / 30, held: C.heldCommands(), present: false, view });
  C.setPadAction(0, 'down', false);
  check('local: pad 1 held stick moves only the first boat\'s heading target', b0.autopilot_heading_target !== before0 && b1.autopilot_heading_target === before1, JSON.stringify([before0, b0.autopilot_heading_target, before1, b1.autopilot_heading_target]));
  C.bindKeys(0);
}

// 6. Server room: a client with two own boats; keyboard → boat 2 and pad 2
// reach only its second boat (the server maps binding boat 1 to it).
{
  const srv = await startServer({ port: 0, adminGate: false, fieldHz: 0 });
  const A = new RemoteHost(`ws://127.0.0.1:${srv.port}/?room=map`, opts, tex(), { WebSocketImpl: WebSocket });
  await A.ready;
  await A.command({ type: 'restart', scenario: 0 });
  const own = [];
  A.on((e) => { if (e.type === 'ownBoats') own.push(e.boats); if (e.type === 'bindControls') C.bindKeys(e.boats); });
  await sleep(200);
  const r1 = await A.command({ type: 'spawnBoat', name: 'P1' });
  const r2 = await A.command({ type: 'spawnBoat', name: 'P2' });
  for (let i = 0; i < 60 && !(own.at(-1) && own.at(-1).length === 2 && C.boundBoats() === 2); i++) await sleep(50);
  const core = srv.rooms.get('map').core;
  const byId = (id) => core.sim.players.find((p) => p.spawnId === id);
  const sent = [];
  C.setInputHost({ command: (c) => { const p = A.command(c); sent.push(p); return p; } });
  C.setInputMap({ keyboard: 'boat2', pads: ['boat1', 'boat2'] });
  const tg = () => [byId(r1.id).autopilot_heading_target, byId(r2.id).autopilot_heading_target];
  // Both autopilots on, so each target is latched.
  await A.command({ type: 'autopilot', boat: 0 });
  await A.command({ type: 'autopilot', boat: 1 });
  const s0 = tg();
  C.setVirtualKey(13, true); C.setVirtualKey(13, false);
  await Promise.all(sent);
  const s1 = tg();
  check('server: keyboard → boat 2, Enter tacks only the client\'s second boat', C.boundBoats() === 2 && s1[1] === -s0[1] && s0[1] !== 0 && s1[0] === s0[0], JSON.stringify([s0, s1]));
  const t0 = [byId(r1.id).autopilot_heading_target, byId(r2.id).autopilot_heading_target];
  sent.length = 0;
  C.setPadAction(1, 'tack', true); C.setPadAction(1, 'tack', false);
  await Promise.all(sent);
  const t1 = [byId(r1.id).autopilot_heading_target, byId(r2.id).autopilot_heading_target];
  check('server: pad 2 → boat 2 tacks only the second own boat', t1[1] === -t0[1] && t0[1] !== 0 && t1[0] === t0[0], JSON.stringify([t0, t1]));
  sent.length = 0;
  C.setPadAction(0, 'tack', true); C.setPadAction(0, 'tack', false);
  await Promise.all(sent);
  const t2 = [byId(r1.id).autopilot_heading_target, byId(r2.id).autopilot_heading_target];
  check('server: pad 1 → boat 1 tacks only the first own boat', t2[0] === -t1[0] && t2[1] === t1[1], JSON.stringify([t1, t2]));
  A.terminate();
  await srv.close();
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all input-map checks passed');
process.exit(0);
