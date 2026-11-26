// Preferences are not URL state: the Preferences tab (player-prefs.js) and
// the Dev TOML (dev-prefs.js) live only in localStorage. Changing one and
// reloading leaves the address bar alone, a preference key in the URL is not
// applied, and stripPrefsFromUrl drops old preference keys (only those).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { installPlayerPrefs, stripPrefsFromUrl, PREFS_KEY } from '../src/player-prefs.js';
import { installDevPrefs } from '../src/dev-prefs.js';
import { DEV_CONFIG_KEY } from '../src/dev-config.js';

function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

// A page URL whose writes are counted.
function fakeWindow(href) {
  const u = new URL(href, 'https://sailzone.app');
  const writes = [];
  const location = {
    get pathname() { return u.pathname; },
    get search() { return u.search; },
    get hash() { return u.hash; },
    get href() { return u.pathname + u.search + u.hash; },
  };
  const history = {
    state: null,
    replaceState(_s, _t, next) { writes.push(next); const n = new URL(next, u); u.pathname = n.pathname; u.search = n.search; u.hash = n.hash; },
    pushState(_s, _t, next) { writes.push(next); },
  };
  return { location, history, writes };
}

function withGlobals(win, storage, fn) {
  const saved = { location: globalThis.location, history: globalThis.history, window: globalThis.window, localStorage: globalThis.localStorage };
  Object.assign(globalThis, { location: win.location, history: win.history, window: win, localStorage: storage });
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } };
  let out;
  try { out = fn(); } catch (e) { restore(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
}

// The Preferences pane: two checkboxes inside #settings and Reset settings.
function prefsDoc() {
  const listeners = { input: [], change: [] };
  const inside = new Set();
  const box = (id, defaultChecked) => {
    const el = { id, tagName: 'INPUT', type: 'checkbox', defaultChecked, checked: defaultChecked, _on: {},
      addEventListener(t, fn) { (el._on[t] ||= []).push(fn); },
      dispatchEvent(e) { const ev = { type: e.type, target: el, isTrusted: false }; for (const fn of listeners[e.type] || []) fn(ev); return true; } };
    inside.add(el);
    return el;
  };
  const els = {
    camera_follow: box('camera_follow', false),
    show_rule_labels: box('show_rule_labels', true),
    settings: { contains: (el) => inside.has(el) },
    reset_settings: { _on: {}, addEventListener(t, fn) { (this._on[t] ||= []).push(fn); } },
  };
  return {
    els,
    getElementById: (id) => els[id] || null,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    // A real click: the box flips, then trusted input + change.
    userToggle(id) { const el = els[id]; el.checked = !el.checked; for (const t of ['input', 'change']) for (const fn of listeners[t]) fn({ type: t, target: el, isTrusted: true }); },
  };
}

test('url-settings.js is gone', () => {
  assert.equal(existsSync(new URL('../src/url-settings.js', import.meta.url)), false);
});

test('changing a preference and reloading leaves the URL unchanged', () => {
  const win = fakeWindow('/play/?host=local');
  const storage = memoryStorage();
  withGlobals(win, storage, () => {
    const doc = prefsDoc();
    installPlayerPrefs(doc);
    doc.userToggle('camera_follow');
    doc.userToggle('show_rule_labels');
    assert.deepEqual(JSON.parse(storage.getItem(PREFS_KEY)), { camera_follow: true, show_rule_labels: false });
    assert.equal(win.location.href, '/play/?host=local');
    // Reload: saved prefs come back from localStorage, the URL stays as it was.
    const again = prefsDoc();
    installPlayerPrefs(again);
    assert.equal(again.els.camera_follow.checked, true);
    assert.equal(again.els.show_rule_labels.checked, false);
    assert.equal(stripPrefsFromUrl(win), false);
    assert.equal(win.location.href, '/play/?host=local');
    assert.deepEqual(win.writes, [], 'nothing wrote to the URL');
  });
});

test('a preference key in the URL is not applied; saved prefs win', () => {
  const win = fakeWindow('/play/?host=local&camera_follow=1&show_rule_labels=0');
  const storage = memoryStorage({ [PREFS_KEY]: JSON.stringify({ show_rule_labels: false }) });
  withGlobals(win, storage, () => {
    const doc = prefsDoc();
    installPlayerPrefs(doc);
    assert.equal(doc.els.camera_follow.checked, false, '?camera_follow=1 ignored');
    assert.equal(doc.els.show_rule_labels.checked, false, 'saved value');
    assert.deepEqual(win.writes, []);
  });
});

test('Reset settings puts the Preferences back to defaults without touching the URL', () => {
  const win = fakeWindow('/play/?host=local');
  const storage = memoryStorage({ [PREFS_KEY]: JSON.stringify({ camera_follow: true, show_rule_labels: false }) });
  withGlobals(win, storage, () => {
    const doc = prefsDoc();
    installPlayerPrefs(doc);
    assert.equal(doc.els.camera_follow.checked, true);
    for (const fn of doc.els.reset_settings._on.click) fn();
    assert.equal(doc.els.camera_follow.checked, false);
    assert.equal(doc.els.show_rule_labels.checked, true);
    assert.equal(storage.getItem(PREFS_KEY), null);
    assert.deepEqual(win.writes, []);
  });
});

function el(id) {
  const box = {
    id, value: '', textContent: '', hidden: true, disabled: false, dataset: {}, scrollTop: 0, _on: {},
    classList: { toggle() {} },
    addEventListener(type, fn) { (box._on[type] ||= []).push(fn); },
    focus() {}, setSelectionRange() {},
    fire(type) { for (const fn of box._on[type] || []) fn(); },
  };
  return box;
}
function editorDoc() {
  const ids = ['dev_config', 'dev_config_check', 'dev_config_status', 'dev_config_mode', 'dev_config_commit', 'dev_config_revert', 'dev_config_reset'];
  const els = Object.fromEntries(ids.map((id) => [id, el(id)]));
  return { getElementById: (id) => els[id] || null, els };
}
const host = { kind: 'local', commandSync: () => ({ ok: true, boats: ['s1'] }), command: () => Promise.resolve({ ok: true }), on() {} };

test('Dev TOML: Apply and reload leave the URL unchanged, and a URL key is not applied', async () => {
  const win = fakeWindow('/play/?host=local');
  const storage = memoryStorage();
  await withGlobals(win, storage, async () => {
    const doc = editorDoc();
    const api = installDevPrefs(doc, { host, storage, applyLocal() {} });
    await api.ready;
    const ta = doc.els.dev_config;
    ta.value = ta.value.replace('ghost_boat = false', 'ghost_boat = true');
    ta.fire('input');
    doc.els.dev_config_commit.fire('click');
    await new Promise((r) => setTimeout(r, 0));
    assert.match(storage.getItem(DEV_CONFIG_KEY), /"ghost_boat":true/);
    assert.equal(win.location.href, '/play/?host=local');
    // Reload with an old link that says ghost=0: the saved document wins.
    const old = fakeWindow('/play/?host=local&ghost=0&autopilotKp=9');
    await withGlobals(old, storage, async () => {
      const again = editorDoc();
      await installDevPrefs(again, { host, storage, applyLocal() {} }).ready;
      assert.match(again.els.dev_config.value, /ghost_boat = true/);
      assert.match(again.els.dev_config.value, /autopilot_kp = 2\b/);
      assert.deepEqual(old.writes, [], 'the Dev editor never writes the URL');
    });
    assert.deepEqual(win.writes, []);
  });
});

test('stripPrefsFromUrl drops old preference keys once and keeps the rest', () => {
  const win = fakeWindow('/fields/pr-preview/pr-1/play/?host=local&camera_follow=1&ghost=1&sticky_autopilot=0&map_size=200x400&scenario_selector=3&devmode=1#x');
  assert.equal(stripPrefsFromUrl(win), true);
  assert.equal(win.location.href, '/fields/pr-preview/pr-1/play/?host=local&map_size=200x400&scenario_selector=3&devmode=1#x');
  assert.equal(stripPrefsFromUrl(win), false, 'nothing left to strip');
  assert.equal(win.writes.length, 1);
  const only = fakeWindow('/play/?touch=1&boat_name=Ann');
  stripPrefsFromUrl(only);
  assert.equal(only.location.href, '/play/');
});
