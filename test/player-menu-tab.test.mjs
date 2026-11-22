// Player menu tab (instrument panel, server rooms only): every own-boat
// control. Selected while the page spectates (name + Join), Readout is
// selected once it joins but the tab stays (name, Leave, second player,
// status). The Preferences settings drawer no longer holds the name, zoom
// or pan controls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupInstrumentPanel } from '../src/instrument-panel.js';
import { setupOwnBoat } from '../src/own-boat.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

function fakeEl(props = {}) {
  const listeners = {};
  const classes = new Set();
  return {
    hidden: false, value: '', textContent: '', dataset: {}, attrs: {},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on) => { if (on === undefined ? !classes.has(c) : on) classes.add(c); else classes.delete(c); },
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild() {}, append() {},
    querySelector: () => fakeEl(),
    querySelectorAll: () => [],
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(ev) { for (const fn of listeners[ev.type] || []) fn(ev); return true; },
    click() { this.dispatchEvent({ type: 'click' }); },
    ...props,
  };
}

function panelHarness() {
  const modes = ['player', 'readout', 'chart', 'instrument'].map((m) => {
    const b = fakeEl({ disabled: m === 'instrument', hidden: m === 'player' });
    b.dataset.mode = m;
    return b;
  });
  const root = fakeEl({
    querySelectorAll: (sel) => (sel === '.instr-mode' ? modes : []),
    querySelector: (sel) => (sel === '.instr-tiles' ? fakeEl() : sel === '.instr-note' ? fakeEl() : null),
  });
  const doc = {
    getElementById: (id) => (id === 'instrument_panel' ? root : null),
    createElement: () => fakeEl(),
    createElementNS: () => fakeEl(),
  };
  const pressed = () => modes.find((b) => b.getAttribute('aria-pressed') === 'true').dataset.mode;
  return { root, modes, doc, pressed, btn: (m) => modes.find((b) => b.dataset.mode === m) };
}


test('markup: Player menu is the first instrument tab and holds every own-boat control', () => {
  const at = html.indexOf('<section id="instrument_panel"');
  const panel = html.slice(at, html.indexOf('</section>', at));
  const tab = panel.indexOf('data-mode="player" hidden');
  assert.ok(tab > 0 && tab < panel.indexOf('class="instr-mode sz-tab" data-mode="readout"'));
  assert.match(panel, /data-mode="player" hidden[^>]*>Player menu<\/button>/);
  for (const id of ['boat_name', 'own_boat_join', 'own_boat_leave', 'own_boat_add', 'own_boat_remove2', 'own_boat_status']) {
    assert.match(panel, new RegExp(`id="${id}"`), id);
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id + ' once');
  }
  assert.ok(!html.includes('player_menu_name'));
  assert.match(html, /#instrument_panel\[data-mode="player"\] \.instr-player \{ display: flex;/);
  assert.match(html, /#instrument_panel\[data-mode="player"\] \.instr-tiles,\n\s*#instrument_panel\[data-mode="player"\] \.instr-charts \{ display: none !important; \}/);
  assert.ok(!html.includes('join_tab_name') && !html.includes('data-mode="join"'));
});

test('markup: Preferences drawer has no name, zoom or pan; Camera Follow stays', () => {
  assert.ok(!html.includes('Spectating · open ☰'));
  assert.ok(!html.includes('tc-spectating'));
  assert.ok(!html.includes('spectating_note'));
  assert.ok(!html.includes('own_boat_panel'));
  assert.ok(!html.includes('camera_zoom_in'));
  assert.ok(!html.includes('camera_zoom_out'));
  assert.ok(!html.includes('camera_move_left'));
  assert.ok(!html.includes('camera_move_right'));
  assert.ok(!html.includes('camera_move_up'));
  assert.ok(!html.includes('camera_move_down'));
  assert.match(html, /id="settings_tab_player"[^>]*>Preferences<\/button>/);
  const at = html.indexOf('<div id="player_panel"');
  const drawer = html.slice(at, html.indexOf('id="dev_panel"', at));
  assert.ok(!drawer.includes('id="boat_name"'), 'name is not in the Preferences pane');
  assert.match(drawer, /id="camera_follow"/);
  assert.match(drawer, /Camera Follow/);
  for (const id of ['own_boat_join', 'own_boat_leave', 'own_boat_add', 'own_boat_remove2', 'own_boat_status']) assert.ok(!drawer.includes(id), id);
});

test('instrument panel: server room shows Player menu always; selected while spectating, Readout after joining', () => {
  store.clear();
  store.set('fields.instrumentMode', 'chart');
  const h = panelHarness();
  const p = setupInstrumentPanel({ remote: true }, h.doc);
  assert.equal(h.btn('player').hidden, false);
  assert.equal(h.root.dataset.mode, 'chart');
  p.setSpectating(true);
  assert.equal(h.root.dataset.mode, 'player');
  assert.equal(h.pressed(), 'player');
  assert.ok(h.root.classList.contains('spectating'));
  // joined: Readout explicitly (not the remembered Chart), the tab stays
  p.setSpectating(false);
  assert.equal(h.root.dataset.mode, 'readout');
  assert.equal(h.btn('player').hidden, false);
  assert.ok(!h.root.classList.contains('spectating'));
  // the player can come back to the menu while sailing
  h.btn('player').click();
  assert.equal(h.root.dataset.mode, 'player');
  assert.notEqual(store.get('fields.instrumentMode'), 'player', 'Player menu is never remembered');
  // leaving selects it again (already there); spectating after Readout too
  h.btn('readout').click();
  p.setSpectating(true);
  assert.equal(h.root.dataset.mode, 'player');
});

test('instrument panel: local / worker mode never shows Player menu', () => {
  store.clear();
  const h = panelHarness();
  const p = setupInstrumentPanel({ remote: false }, h.doc);
  assert.equal(h.btn('player').hidden, true);
  p.setSpectating(true);
  assert.equal(h.root.dataset.mode, 'readout');
  h.btn('player').click();
  assert.equal(h.root.dataset.mode, 'readout');
});

function ownHarness({ saved = '' } = {}) {
  const ids = ['own_boat_join', 'own_boat_leave', 'own_boat_add', 'own_boat_remove2', 'boat_name', 'own_boat_status', 'touch_controls', 'camera_follow'];
  const els = Object.fromEntries(ids.map((id) => [id, fakeEl({ id })]));
  els.boat_name.value = saved;
  const doc = { body: fakeEl(), getElementById: (id) => els[id] || null };
  const hostListeners = [];
  const commands = [];
  let reply = {};
  const host = {
    kind: 'remote', own: [],
    on: (fn) => hostListeners.push(fn),
    command: (c) => { commands.push(c); return Promise.resolve(reply); },
  };
  const emit = (boats) => { for (const fn of hostListeners) fn({ type: 'ownBoats', boats }); };
  return { els, doc, host, commands, emit, setReply: (r) => { reply = r; } };
}


test('own boat: name lives in Player menu; stays visible after join; Join spawns', async () => {
  const h = ownHarness({ saved: 'Ann' });
  const calls = [];
  let saves = 0;
  setupOwnBoat(h.host, (ids) => calls.push(ids), { savePrefs: () => saves++ }, h.doc);
  assert.deepEqual(calls.at(-1), []);
  assert.equal(h.els.boat_name.value, 'Ann');
  assert.equal(h.els.boat_name.hidden, false);
  assert.equal(h.els.own_boat_join.hidden, false);
  for (const id of ['own_boat_leave', 'own_boat_add', 'own_boat_remove2']) assert.equal(h.els[id].hidden, true, id);
  assert.ok(h.doc.body.classList.contains('spectating'));
  h.els.boat_name.value = 'Bea';
  h.els.boat_name.dispatchEvent({ type: 'input' });
  assert.equal(saves, 1);
  h.els.own_boat_join.click();
  assert.equal(h.commands.at(-1).type, 'spawnBoat');
  assert.equal(h.commands.at(-1).name, 'Bea');
  h.emit([{ id: 'b1', name: 'Bea' }]);
  assert.deepEqual(calls.at(-1), ['b1']);
  assert.equal(h.els.own_boat_join.hidden, true);
  assert.equal(h.els.boat_name.hidden, false, 'name stays editable after join');
  assert.equal(h.els.own_boat_leave.hidden, false);
  assert.equal(h.els.own_boat_add.hidden, false);
  assert.equal(h.els.own_boat_remove2.hidden, true);
  assert.match(h.els.own_boat_status.textContent, /^Sailing Bea/);
  // second boat uses the current name field
  h.els.boat_name.value = 'Cy';
  h.els.own_boat_add.click();
  assert.equal(h.commands.at(-1).name, 'Cy 2');
  h.emit([{ id: 'b1', name: 'Bea' }, { id: 'b2', name: 'Cy 2' }]);
  assert.equal(h.els.own_boat_add.hidden, true);
  assert.equal(h.els.own_boat_remove2.hidden, false);
  assert.equal(h.els.boat_name.hidden, false);
  h.els.own_boat_remove2.click();
  assert.deepEqual(h.commands.at(-1), { type: 'removeBoat', id: 'b2' });
  h.els.own_boat_leave.click();
  assert.deepEqual(h.commands.slice(-2).map((c) => c.id), ['b1', 'b2']);
  h.emit([]);
  assert.deepEqual(calls.at(-1), []);
  assert.equal(h.els.own_boat_join.hidden, false);
  assert.equal(h.els.own_boat_leave.hidden, true);
  assert.equal(h.els.own_boat_status.textContent, '');
});

test('own boat: a refused join shows its error in the status line; Enter joins', async () => {
  const h = ownHarness();
  setupOwnBoat(h.host, () => {}, {}, h.doc);
  h.setReply({ error: 'room full' });
  h.els.own_boat_join.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.els.own_boat_status.textContent, 'Cannot join: room full');
  h.els.boat_name.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(h.commands.length, 2);
});

test('main.js tells the instrument panel when the page spectates', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /instruments\.setSpectating\(ids\.length === 0\)/);
  assert.match(main, /savePrefs: playerPrefs && playerPrefs\.save/);
});
