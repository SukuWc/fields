// Join tab (instrument panel): while a server-room page spectates, the panel
// shows a Join tab, selected by default, with the join-with-boat controls;
// joining hides it and goes back to the remembered mode. The old
// "Spectating · open ☰ …" overlay over the touch controls is gone.
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
  const modes = ['join', 'readout', 'chart', 'instrument'].map((m) => {
    const b = fakeEl({ disabled: m === 'instrument', hidden: m === 'join' });
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

test('markup: Join tab first in the instrument panel, holds the name field and the join button', () => {
  const panel = html.slice(html.indexOf('<section id="instrument_panel"'), html.indexOf('</section>', html.indexOf('<section id="instrument_panel"')));
  const join = panel.indexOf('class="instr-mode sz-tab" data-mode="join"');
  assert.ok(join > 0 && join < panel.indexOf('class="instr-mode sz-tab" data-mode="readout"'));
  assert.match(panel, /<button type="button" class="instr-mode sz-tab" data-mode="join" hidden/);
  assert.match(panel, /id="join_tab_name"/);
  assert.match(panel, /id="own_boat_join"/);
  assert.equal((html.match(/id="own_boat_join"/g) || []).length, 1, 'one join button, in the tab');
  assert.match(html, /#instrument_panel\[data-mode="join"\] \.instr-join \{ display: flex;/);
  assert.match(html, /#instrument_panel\[data-mode="join"\] \.instr-tiles,\n\s*#instrument_panel\[data-mode="join"\] \.instr-charts \{ display: none !important; \}/);
});

test('markup: the legacy spectating overlay and drawer note are removed', () => {
  assert.ok(!html.includes('Spectating · open ☰'));
  assert.ok(!html.includes('tc-spectating'));
  assert.ok(!html.includes('spectating_note'));
  // the drawer keeps the saved name, Leave and the second player
  const drawer = html.slice(html.indexOf('id="own_boat_panel"'), html.indexOf('id="own_boat_status"'));
  for (const id of ['boat_name', 'own_boat_add', 'own_boat_remove2', 'own_boat_leave']) assert.match(drawer, new RegExp(`id="${id}"`));
  assert.ok(!drawer.includes('own_boat_join'));
});

test('instrument panel: Join appears and is selected while spectating, goes back after joining', () => {
  store.clear();
  const h = panelHarness();
  const p = setupInstrumentPanel({ remote: true }, h.doc);
  assert.equal(h.pressed(), 'readout');
  assert.equal(h.btn('join').hidden, true);
  p.setSpectating(true);
  assert.equal(h.btn('join').hidden, false);
  assert.equal(h.root.dataset.mode, 'join');
  assert.equal(h.pressed(), 'join');
  // the player can look at Readout while spectating; Join stays available
  h.btn('readout').click();
  assert.equal(h.root.dataset.mode, 'readout');
  assert.equal(h.btn('join').hidden, false);
  h.btn('join').click();
  assert.equal(h.root.dataset.mode, 'join');
  assert.notEqual(store.get('fields.instrumentMode'), 'join', 'Join is never remembered');
  p.setSpectating(false);
  assert.equal(h.btn('join').hidden, true);
  assert.equal(h.root.dataset.mode, 'readout');
  // spectating again selects Join again
  p.setSpectating(true);
  assert.equal(h.root.dataset.mode, 'join');
});

test('instrument panel: after joining, the remembered mode (Chart) comes back; Join is refused when not spectating', () => {
  store.clear();
  store.set('fields.instrumentMode', 'chart');
  const h = panelHarness();
  const p = setupInstrumentPanel({ remote: true }, h.doc);
  assert.equal(h.root.dataset.mode, 'chart');
  h.btn('join').click();
  assert.equal(h.root.dataset.mode, 'readout', 'hidden Join tab cannot be selected');
  store.set('fields.instrumentMode', 'chart');
  p.setSpectating(true);
  assert.equal(h.root.dataset.mode, 'join');
  p.setSpectating(false);
  assert.equal(h.root.dataset.mode, 'chart');
});

function ownHarness({ saved = '' } = {}) {
  const ids = ['own_boat_panel', 'own_boat_join', 'own_boat_leave', 'own_boat_add', 'own_boat_remove2', 'boat_name', 'own_boat_status', 'join_tab_name', 'join_tab_status', 'touch_controls', 'camera_follow'];
  const els = Object.fromEntries(ids.map((id) => [id, fakeEl({ id })]));
  els.own_boat_panel.hidden = true;
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

test('own boat: Join tab name mirrors the saved Player name; Join spawns with it; spectating toggles the tab', async () => {
  const h = ownHarness({ saved: 'Ann' });
  const calls = [];
  let saves = 0;
  setupOwnBoat(h.host, (ids) => calls.push(ids), { savePrefs: () => saves++ }, h.doc);
  assert.deepEqual(calls.at(-1), []);
  assert.equal(h.els.own_boat_panel.hidden, false);
  assert.equal(h.els.join_tab_name.value, 'Ann');
  assert.equal(h.els.own_boat_join.hidden, false);
  assert.equal(h.els.own_boat_leave.hidden, true);
  assert.ok(h.doc.body.classList.contains('spectating'));
  // typing in the tab writes the one saved value
  h.els.join_tab_name.value = 'Bea';
  h.els.join_tab_name.dispatchEvent({ type: 'input' });
  assert.equal(h.els.boat_name.value, 'Bea');
  assert.equal(saves, 1);
  // editing the drawer name updates the tab
  h.els.boat_name.value = 'Cy';
  h.els.boat_name.dispatchEvent({ type: 'input' });
  assert.equal(h.els.join_tab_name.value, 'Cy');
  h.els.own_boat_join.click();
  assert.equal(h.commands.at(-1).type, 'spawnBoat');
  assert.equal(h.commands.at(-1).name, 'Cy');
  h.emit([{ id: 'b1', name: 'Cy' }]);
  assert.deepEqual(calls.at(-1), ['b1']);
  assert.equal(h.els.own_boat_join.hidden, true);
  assert.equal(h.els.own_boat_leave.hidden, false);
  assert.ok(!h.doc.body.classList.contains('spectating'));
  h.emit([]);
  assert.deepEqual(calls.at(-1), []);
  assert.equal(h.els.own_boat_join.hidden, false);
});

test('own boat: a refused join shows its error in the Join tab', async () => {
  const h = ownHarness();
  setupOwnBoat(h.host, () => {}, {}, h.doc);
  h.setReply({ error: 'room full' });
  h.els.own_boat_join.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.els.join_tab_status.textContent, 'Cannot join: room full');
  // Enter in the name field joins too
  h.els.join_tab_name.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert.equal(h.commands.length, 2);
});

test('main.js tells the instrument panel when the page spectates', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /instruments\.setSpectating\(ids\.length === 0\)/);
  assert.match(main, /savePrefs: playerPrefs && playerPrefs\.save/);
});
