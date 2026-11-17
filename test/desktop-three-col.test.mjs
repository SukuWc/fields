// Desktop three-column HUD (index.html "Desktop three-column HUD",
// src/desktop-hud.js): which windows get it (layout.js queries), the zone
// structure and grid CSS, the chat column (chat or the solo placeholder),
// the slide-over drawer (closed on load, Escape closes) and the collapsible
// minimap column.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAYOUT_CLASSES, layoutClasses, DESKTOP_QUERY } from '../src/layout.js';
import { setupChat } from '../src/chat-panel.js';
import { setupDesktopHud, MM_STORE_KEY } from '../src/desktop-hud.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Minimal media-query evaluator for the features layout.js uses.
function evalQuery(query, dev) {
  return query.split(',').some((part) => (part.match(/\(([^)]+)\)/g) || []).every((c) => {
    const [k, v] = c.slice(1, -1).split(':').map((x) => x.trim());
    const n = parseFloat(v);
    switch (k) {
      case 'min-width': return dev.w >= n;
      case 'max-width': return dev.w <= n;
      case 'min-height': return dev.h >= n;
      case 'max-height': return dev.h <= n;
      case 'hover': return dev.hover === v;
      case 'pointer': return dev.pointer === v;
      case 'orientation': return (dev.w >= dev.h ? 'landscape' : 'portrait') === v;
      default: throw new Error('unknown feature ' + k);
    }
  }));
}
const mouse = (w, h) => ({ w, h, hover: 'hover', pointer: 'fine' });
const touch = (w, h) => ({ w, h, hover: 'none', pointer: 'coarse' });
const classes = (dev) => new Set(layoutClasses((q) => evalQuery(q, dev)));

test('desktop three-column HUD from 1000 px; compact (minimap button) under 1158 px', () => {
  for (const [w, h] of [[1000, 700], [1280, 800], [1440, 600], [2560, 1440]]) {
    const c = classes(mouse(w, h));
    assert.ok(c.has('bp-desktop') && c.has('bp-wide'), `${w}x${h}`);
    assert.ok(!c.has('bp-touch') && !c.has('bp-tablet') && !c.has('bp-phone'), `${w}x${h}`);
  }
  assert.ok(classes(mouse(1024, 640)).has('bp-desktop-compact'));
  assert.ok(classes(mouse(1157, 700)).has('bp-desktop-compact'));
  assert.ok(!classes(mouse(1158, 700)).has('bp-desktop-compact'));
});

test('narrow desktop windows fall back to the tablet (or phone) layout', () => {
  const t = classes(mouse(999, 700));
  assert.ok(t.has('bp-tablet') && t.has('bp-touch') && t.has('bp-wide') && !t.has('bp-desktop'));
  const p = classes(mouse(960, 560));
  assert.ok(p.has('bp-phone') && p.has('bp-touch') && !p.has('bp-tablet') && !p.has('bp-desktop'));
  // Every touch-chrome window is exactly one of phone / tablet.
  for (const d of [mouse(800, 700), mouse(800, 500), mouse(999, 599), touch(1024, 768), touch(390, 844), touch(844, 390)]) {
    const c = classes(d);
    if (c.has('bp-touch')) assert.equal(Number(c.has('bp-phone')) + Number(c.has('bp-tablet')), 1, JSON.stringify(d));
  }
});

test('phone and tablet devices keep their layout classes', () => {
  assert.deepEqual([...classes(touch(1024, 768))].sort(), ['bp-coarse', 'bp-tablet', 'bp-touch', 'bp-wide']);
  assert.deepEqual([...classes(touch(390, 844))].sort(), ['bp-coarse', 'bp-phone', 'bp-touch']);
  assert.deepEqual([...classes(touch(844, 390))].sort(), ['bp-coarse', 'bp-phone', 'bp-phone-landscape', 'bp-short-landscape', 'bp-touch']);
  assert.deepEqual([...classes(mouse(700, 900))].sort(), ['bp-phone', 'bp-touch']);
  assert.ok('bp-desktop-compact' in LAYOUT_CLASSES);
});

test('HUD zones: one grid with left / middle / right zones and a chat slot', () => {
  const grid = html.slice(html.indexOf('<div id="hud_grid"'), html.indexOf('<div id="mobile_strip"'));
  for (const id of ['hud_top', 'hud_rcol', 'hud_right', 'hud_toasts', 'hud_chat', 'chat_panel', 'chat_placeholder', 'hud_instruments', 'instrument_panel', 'hud_minimap', 'minimap', 'mm_toggle']) {
    assert.ok(grid.includes(`id="${id}"`), id);
  }
  const rcol = grid.slice(grid.indexOf('id="hud_rcol"'), grid.indexOf('id="hud_instruments"'));
  assert.ok(rcol.indexOf('id="hud_right"') < rcol.indexOf('id="hud_toasts"') && rcol.indexOf('id="hud_toasts"') < rcol.indexOf('id="hud_chat"'));
  assert.match(html, /\.bp-desktop #hud_grid \{[^}]*grid-template-columns: var\(--col-l\) minmax\(0, 1fr\) var\(--col-r\);/);
  assert.match(html, /--col-l: clamp\(160px, calc\(100vw - 998px\), 320px\);/);
  assert.match(html, /\.bp-desktop-compact body \{ --col-l: 48px; \}/);
  assert.match(html, /\.bp-desktop #hud_grid #hud_rcol \{ grid-column: 3; grid-row: 1 \/ -1;/);
  assert.match(html, /\.bp-desktop #hud_grid #instrument_panel \.instr-tiles \{ grid-template-columns: repeat\(auto-fit, minmax\(60px, 1fr\)\); \}/);
  // No magic offsets left from the old fixed zones, and the drawer no longer pushes the HUD.
  assert.doesNotMatch(html, /left: 360px/);
  assert.doesNotMatch(html, /settings-open \{ --hud-right/);
  assert.match(html, /\.bp-desktop #settings \{[^}]*width: var\(--drawer-w\);[^}]*transform: translateX/);
  assert.match(html, /--drawer-w: var\(--col-r\)/);
  // Touch steer zones follow the columns.
  assert.match(html, /\.tc-steer\.tc-right \{ left: auto; right: calc\(var\(--d-pad\) \+ var\(--col-r\) \+ var\(--d-gap\) \+ 6px\); \}/);
});

// Fake DOM for chat-panel.js / desktop-hud.js.
function fakeEl(id) {
  const listeners = {};
  const attrs = {};
  const cls = new Set();
  const el = {
    id, hidden: false, textContent: '', value: '', childNodes: [], childElementCount: 0, scrollTop: 0, scrollHeight: 0, clientHeight: 0, title: '',
    style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    classList: { toggle(c, on) { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); }, contains: (c) => cls.has(c), add: (c) => cls.add(c), remove: (c) => cls.delete(c) },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null),
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    fire(t, e = {}) { for (const fn of listeners[t] || []) fn({ preventDefault() {}, stopPropagation() {}, ...e }); },
    appendChild(c) { el.childNodes.push(c); el.childElementCount++; return c; },
    removeChild(c) { el.childNodes.splice(el.childNodes.indexOf(c), 1); },
    get firstChild() { return el.childNodes[0]; },
    getBoundingClientRect: () => ({ height: 180 }),
  };
  return el;
}
function fakeDoc(ids) {
  const els = Object.fromEntries(ids.map((i) => [i, fakeEl(i)]));
  return { els, body: fakeEl('body'), getElementById: (i) => els[i] || null, createElement: () => fakeEl('') };
}
const CHAT_IDS = ['chat_panel', 'chat_placeholder', 'chat_toggle', 'chat_body', 'chat_log', 'chat_form', 'chat_input', 'chat_status', 'chat_unread', 'chat_quick'];

test('local / worker games: chat hidden, the placeholder holds the slot', () => {
  for (const kind of ['local', 'worker']) {
    const doc = fakeDoc(CHAT_IDS);
    doc.els.chat_placeholder.hidden = true;
    assert.equal(setupChat({ kind }, doc, { desktop: true }), null);
    assert.equal(doc.els.chat_panel.hidden, true);
    assert.equal(doc.els.chat_placeholder.hidden, false);
  }
  assert.match(html, /<div id="chat_placeholder"[^>]*hidden[\s\S]*?Chat is available in multiplayer rooms[\s\S]*?<input type="text" disabled/);
  assert.match(html, /#chat_placeholder \{ display: none; \}/); // never on phone / tablet
});

test('server rooms: chat shown, placeholder hidden, open by default on desktop only', () => {
  const host = (chat = []) => ({ kind: 'remote', sendChat: async () => ({ ok: true }), chat, on() {} });
  const d = fakeDoc(CHAT_IDS);
  setupChat(host(), d, { desktop: true });
  assert.equal(d.els.chat_panel.hidden, false);
  assert.equal(d.els.chat_placeholder.hidden, true);
  assert.equal(d.els.chat_body.hidden, false);
  assert.equal(d.els.chat_toggle.getAttribute('aria-expanded'), 'true');
  const m = fakeDoc(CHAT_IDS);
  setupChat(host(), m, { desktop: false });
  assert.equal(m.els.chat_body.hidden, true);
  assert.ok(DESKTOP_QUERY.includes('1000px'));
});

test('compact desktop: the Map button expands / collapses the minimap column and is remembered', () => {
  const doc = fakeDoc(['mm_toggle', 'hud_instruments']);
  const store = new Map();
  const win = { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
  setupDesktopHud(doc, win);
  assert.equal(doc.body.classList.contains('mm-expanded'), false);
  assert.equal(doc.els.mm_toggle.textContent, 'Map');
  assert.equal(doc.body.style.props['--ip-live'], '180px');
  doc.els.mm_toggle.fire('click');
  assert.equal(doc.body.classList.contains('mm-expanded'), true);
  assert.equal(doc.els.mm_toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(store.get(MM_STORE_KEY), '1');
  const again = fakeDoc(['mm_toggle', 'hud_instruments']);
  setupDesktopHud(again, win);
  assert.equal(again.body.classList.contains('mm-expanded'), true);
  assert.match(html, /\.bp-desktop-compact body:not\(\.mm-expanded\) #hud_grid #minimap \{ display: none; \}/);
});

test('settings drawer: closed on load, Escape closes it on desktop', async () => {
  const doc = fakeDoc(['settings_toggle', 'settings', 'settings_backdrop', 'settings_edge']);
  doc.els.settings.contains = (el) => el === doc.els.inside;
  doc.els.inside = fakeEl('inside');
  let focused = null;
  doc.els.settings_toggle.focus = () => { focused = 'toggle'; };
  const docListeners = {};
  const saved = { document: globalThis.document, window: globalThis.window, location: globalThis.location };
  globalThis.document = { ...doc, activeElement: doc.els.inside, addEventListener: (t, fn) => { (docListeners[t] ||= []).push(fn); } };
  globalThis.window = { matchMedia: (q) => ({ matches: q === DESKTOP_QUERY, addEventListener() {} }), addEventListener() {} };
  globalThis.location = { search: '' };
  try {
    const { setupMobileMenu } = await import('../src/mobile-menu.js');
    setupMobileMenu();
    assert.equal(doc.body.classList.contains('settings-open'), false);
    doc.els.settings_toggle.fire('click');
    assert.equal(doc.body.classList.contains('settings-open'), true);
    for (const fn of docListeners.keydown) fn({ key: 'Escape' });
    assert.equal(doc.body.classList.contains('settings-open'), false);
    assert.equal(focused, 'toggle');
  } finally {
    Object.assign(globalThis, saved);
  }
});
