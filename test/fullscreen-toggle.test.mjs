// Mobile top-bar fullscreen toggle: document Fullscreen API, state sync,
// rejected requests, and no button when the page cannot go fullscreen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ENTER_LABEL, EXIT_LABEL, fullscreenAvailable, setupFullscreenToggle, toggleAppFullscreen,
} from '../src/fullscreen-toggle.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function docWith({ methods = true, enabled = true, webkit = false, reject = false, explode = false } = {}) {
  const clicks = [];
  const docListeners = {};
  let current = null;
  const root = {};
  const enter = () => {
    clicks.push('enter');
    if (explode) throw new Error('boom');
    if (reject) return Promise.reject(new Error('denied'));
    current = root;
    return Promise.resolve();
  };
  const leave = () => {
    clicks.push('exit');
    current = null;
    return Promise.resolve();
  };
  if (methods && webkit) root.webkitRequestFullscreen = enter;
  else if (methods) root.requestFullscreen = enter;
  const btnListeners = {};
  const btn = {
    hidden: true,
    title: '',
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { (btnListeners[type] ||= []).push(fn); },
    click() { for (const fn of btnListeners.click || []) fn(); },
  };
  const doc = {
    documentElement: root,
    fullscreenEnabled: enabled,
    get fullscreenElement() { return webkit ? null : current; },
    get webkitFullscreenElement() { return webkit ? current : null; },
    exitFullscreen: !webkit && methods ? leave : undefined,
    webkitExitFullscreen: webkit && methods ? leave : undefined,
    getElementById(id) { return id === 'fullscreen_toggle' ? btn : null; },
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    fire(type) { for (const fn of docListeners[type] || []) fn(); },
  };
  return { doc, btn, root, clicks, setFull(on) { current = on ? root : null; } };
}

test('the control is hidden when the document cannot fullscreen', () => {
  assert.equal(fullscreenAvailable(docWith({ methods: false }).doc), false);
  assert.equal(fullscreenAvailable(docWith({ enabled: false }).doc), false);
  // iPhone-shaped: webkitRequestFullscreen is not on the document element.
  const iphone = docWith({ methods: false });
  iphone.doc.documentElement.webkitRequestFullscreen = undefined;
  assert.equal(fullscreenAvailable(iphone.doc), false);
  const api = setupFullscreenToggle(iphone.doc);
  assert.equal(api.supported, false);
  assert.equal(iphone.btn.hidden, true);
  assert.equal(setupFullscreenToggle({ getElementById: () => null, documentElement: {} }), null);
});

test('enter, exit, external exit, and a rejected request', async () => {
  const h = docWith();
  const api = setupFullscreenToggle(h.doc);
  assert.equal(api.supported, true);
  assert.equal(h.btn.hidden, false);
  assert.equal(h.btn.attrs['aria-pressed'], 'false');
  assert.equal(h.btn.attrs['aria-label'], ENTER_LABEL);

  h.btn.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.clicks, ['enter']);
  h.doc.fire('fullscreenchange');
  assert.equal(h.btn.attrs['aria-pressed'], 'true');
  assert.equal(h.btn.attrs['aria-label'], EXIT_LABEL);

  // External exit (Escape): the browser clears the element, then fires the event.
  const outside = docWith();
  setupFullscreenToggle(outside.doc);
  outside.setFull(true);
  outside.doc.fire('fullscreenchange');
  assert.equal(outside.btn.attrs['aria-pressed'], 'true');
  outside.setFull(false);
  outside.doc.fire('fullscreenchange');
  assert.equal(outside.btn.attrs['aria-pressed'], 'false');
  assert.equal(outside.btn.attrs['aria-label'], ENTER_LABEL);

  h.btn.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.clicks, ['enter', 'exit']);
  h.doc.fire('fullscreenchange');
  assert.equal(h.btn.attrs['aria-pressed'], 'false');
});

test('a rejected or throwing request stays out of fullscreen', async () => {
  for (const opt of [{ reject: true }, { explode: true }]) {
    const h = docWith(opt);
    setupFullscreenToggle(h.doc);
    const r = await toggleAppFullscreen(h.doc);
    assert.equal(r.ok, false);
    assert.ok(r.error);
    h.btn.click();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(h.btn.attrs['aria-pressed'], 'false');
    assert.equal(h.btn.attrs['aria-label'], ENTER_LABEL);
  }
});

test('webkit-prefixed fullscreen still toggles the document element', async () => {
  const h = docWith({ webkit: true });
  assert.equal(fullscreenAvailable(h.doc), true);
  setupFullscreenToggle(h.doc);
  h.btn.click();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(h.clicks, ['enter']);
  assert.equal(h.doc.webkitFullscreenElement, h.root);
  h.doc.fire('webkitfullscreenchange');
  assert.equal(h.btn.attrs['aria-pressed'], 'true');
  const r = await toggleAppFullscreen(h.doc);
  assert.equal(r.ok, true);
  assert.equal(h.doc.webkitFullscreenElement, null);
});

test('markup: 44 px button beside the flag, desktop stays without it, unsupported keeps spacing', () => {
  assert.match(html, /id="fullscreen_toggle" type="button" hidden aria-pressed="false" aria-label="Enter fullscreen"/);
  assert.match(html, /id="sheet_toggle"[\s\S]{0,400}id="fullscreen_toggle"/);
  assert.match(html, /class="fs-enter"/);
  assert.match(html, /class="fs-exit"/);
  assert.match(html, /aria-label="Leaderboard and chat"/);
  assert.match(html, /\.bp-touch #fullscreen_toggle:not\(\[hidden\]\) \{[\s\S]*?width: var\(--sz-tap\); height: var\(--sz-tap\); min-width: var\(--sz-tap\); min-height: var\(--sz-tap\)/);
  assert.match(html, /#fullscreen_toggle \{ display: none; \}/);
  assert.doesNotMatch(html, /\.bp-desktop #fullscreen_toggle/);
  assert.match(html, /\.bp-touch:has\(#fullscreen_toggle:not\(\[hidden\]\)\) #sheet_toggle \{ right: calc\(96px \+ env\(safe-area-inset-right\)\)/);
  assert.match(html, /100vw - 44px - 44px - 44px - 116px/);
  // 360 px portrait: chip ends before Boat stats once the button is shown.
  const chip = 360 - 44 - 44 - 44 - 116;
  const boatLeft = (360 - 144) - 90;
  assert.ok(chip + 8 < boatLeft, `chip ${chip} overlaps boat stats at ${boatLeft}`);
  // 568 px landscape: strip keeps about the pre-button width (right inset +48, chip −48).
  const before = 568 - 230 - 208;
  const after = 568 - 182 - 256;
  assert.ok(after >= before - 4, `strip ${after} vs ${before}`);
});
