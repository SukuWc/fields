// Top HUD merge (Group 5): scenario name/description live in the minimap UI;
// phones merge the navy top bar with the BSP/VMG quick-stats strip into one row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('scenario card sits in the minimap zone, not the top bar', () => {
  const zone = html.slice(html.indexOf('<div id="hud_minimap"'), html.indexOf('id="mm_toggle"'));
  assert.match(zone, /id="scenario_card"/);
  assert.match(zone, /id="minimap"/);
  assert.ok(zone.indexOf('id="scenario_card"') < zone.indexOf('id="minimap"'));
  // No longer pinned into the desktop top bar.
  assert.doesNotMatch(html, /\.bp-desktop #scenario_card \{\n\s+top: 0; left: 0;/);
  assert.match(html, /\.bp-desktop #hud_minimap #scenario_card \{/);
});

test('top HUD wraps the bar and the quick-stats strip as one component', () => {
  assert.match(html, /<div id="top_hud">/);
  const top = html.slice(html.indexOf('<div id="top_hud">'), html.indexOf('</div>', html.indexOf('<div id="mobile_strip"')));
  assert.match(top, /id="mobile_bar"/);
  assert.match(top, /id="mobile_strip"/);
  // Single row on phones: --m-top equals the bar, strip shares that height.
  assert.match(html, /\.bp-touch body \{ --m-bar: calc\(44px \+ env\(safe-area-inset-top\)\); --m-top: var\(--m-bar\); --race-top: calc\(var\(--m-bar\) \+ 1px\); \}/);
  assert.match(html, /\.bp-touch #mobile_strip \{\n\s+top: 0; height: var\(--m-bar\);/);
});

test('fullscreen control stays reachable on the merged top row', () => {
  assert.match(html, /id="fullscreen_toggle"/);
  assert.match(html, /\.bp-touch #fullscreen_toggle:not\(\[hidden\]\) \{/);
  assert.match(html, /\.bp-touch:has\(#fullscreen_toggle:not\(\[hidden\]\)\) #mobile_strip \{/);
  assert.match(html, /\.bp-touch:has\(#fullscreen_toggle:not\(\[hidden\]\)\) #sheet_toggle \{ right: calc\(96px \+ env\(safe-area-inset-right\)\)/);
});

// Race timer rows (#236 lifecycle line, #238 restart vote) make #start_hud
// taller: phone toasts follow its live height and the scenario card under the
// minimap instead of a fixed 112px offset that covered the vote button.
test('phone toasts stack below the live timer height and the scenario card', async () => {
  assert.doesNotMatch(html, /\.bp-touch body:has\(#start_hud:not\(\[hidden\]\)\) \.rule-toasts \{ top: calc\(var\(--m-top\) \+ 112px\); \}/);
  assert.match(html, /\.bp-touch body:has\(#start_hud:not\(\[hidden\]\)\) \.rule-toasts \{\n\s+top: max\(calc\(var\(--m-top\) \+ 14px \+ var\(--start-hud-h, 98px\)\), calc\(var\(--scenario-card-b, 0px\) \+ 6px\)\);/);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /setupStartHudSize\(\);/);

  const { setupStartHudSize, startHudVars } = await import('../src/start-hud-size.js');
  const el = (h, b, hidden = false) => ({ hidden, getClientRects: () => (hidden ? [] : [1]), getBoundingClientRect: () => ({ height: h, bottom: b }) });
  const els = { start_hud: el(129.4, 181), scenario_card: el(38, 184.2) };
  const props = {};
  const doc = { getElementById: (id) => els[id] || null, body: { style: { setProperty: (k, v) => { props[k] = v; } } } };
  assert.deepEqual(startHudVars(doc), { h: 129, cardB: 184 });
  setupStartHudSize(doc, null);
  assert.equal(props['--start-hud-h'], '129px');
  assert.equal(props['--scenario-card-b'], '184px');
  els.start_hud = el(0, 0, true);
  els.scenario_card = el(0, 0, true);
  assert.deepEqual(startHudVars(doc), { h: 0, cardB: 0 });
});
