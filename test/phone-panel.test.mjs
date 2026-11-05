import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READOUT_TILES } from '../src/instrument-readout.js';
import { STRIP_CELLS } from '../src/mobile-strip.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const P = '.bp-phone';
const L = '.bp-phone-landscape body.touch-on.tc-overlay';

test('phones dock the instrument panel at the very bottom in both orientations', () => {
  assert.ok(html.includes(`${P} #instrument_panel {\n        display: block;`));
  assert.ok(html.includes(`${P} #instrument_panel {\n        display: block; position: fixed;`));
  assert.ok(html.includes('bottom: 0; height: calc(var(--ph-h) + env(safe-area-inset-bottom));'));
  assert.ok(html.includes(`${L} #instrument_panel {\n        display: block;`));
  assert.ok(html.includes(`${L} #instrument_panel {\n        display: block; left: calc(6px + env(safe-area-inset-left)); right: calc(6px + env(safe-area-inset-right));\n        bottom: 0;`));
});

test('Overlay steers share the two circular-button-row height; Classic is gone', () => {
  assert.ok(html.includes('--tc-steer-h: 116px'));
  assert.ok(html.includes('.bp-phone:not(.bp-phone-landscape) body.tc-overlay .tc-steer {\n        top: auto;\n        bottom: calc(var(--ph-h) + 14px + env(safe-area-inset-bottom));\n        height: var(--tc-steer-h);'));
  assert.ok(html.includes('--tc-steer-h: 190px'));
  // No Classic-above-grid panel docking leftover.
  assert.ok(!html.includes('body.touch-on #instrument_panel { bottom: calc(var(--touch-panel-h) + 6px); }'));
  assert.ok(!html.includes('id="touch_layout"'));
});

test('phone Readout hides exactly the tiles the top strip already shows', () => {
  for (const c of STRIP_CELLS) {
    assert.ok(READOUT_TILES.some((t) => t.key === c.key));
    assert.ok(html.includes(`${P} #instrument_panel .instr-tile[data-key="${c.key}"]`), c.key);
  }
});

test('Instrument mode stays disabled', () => {
  assert.match(html, /data-mode="instrument" disabled/);
});
