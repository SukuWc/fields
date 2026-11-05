import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupRankChip } from '../src/rank-chip.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../src/controls.js', import.meta.url), 'utf8');

test('desktop top bar: bar, scenario chip, rank chip and menu in one 44 px row', () => {
  assert.match(html, /\.bp-desktop #mobile_bar \{\n\s+display: block;/);
  assert.match(html, /\.bp-desktop #scenario_card \{\n\s+top: 0; left: 0;/);
  assert.match(html, /<span id="bar_rank" hidden><\/span>/);
  assert.match(html, /\.bp-desktop #settings_toggle \{[^}]*top: 0; right: 0;/);
  assert.match(html, /\.bp-desktop #settings \{\n\s+top: calc\(var\(--d-bar\) \+ 6px\)/);
  assert.match(controls, /let scenarioCardCollapsed = true;/);
});

function el() { return { hidden: true, textContent: '', attrs: {}, classList: { toggle() {} }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; } }; }

test('bar rank chip follows the leaderboard and hides without one', () => {
  const chip = el(), bar = el(), btn = el();
  btn.querySelector = () => chip;
  const doc = { body: { classList: { toggle() {} } }, getElementById: (id) => ({ sheet_toggle: btn, bar_rank: bar })[id] || null };
  const rc = setupRankChip({}, doc);
  rc.onFrame({ boats: [{}, {}], hud: { lb: [{ position: 2, boat: 0 }, { position: 1, boat: 1 }] } });
  assert.equal(bar.hidden, false);
  assert.equal(bar.textContent, '2/2');
  rc.onFrame({ boats: [{}], hud: {} });
  assert.equal(bar.hidden, true);
});
