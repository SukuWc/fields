import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READOUT_TILES } from '../src/instrument-readout.js';
import { STRIP_CELLS } from '../src/mobile-strip.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const P = '.bp-phone';
const L = '.bp-phone-landscape body.touch-on.tc-overlay';

test('portrait docks the instrument panel full-width at the very bottom', () => {
  assert.ok(html.includes('.bp-phone:not(.bp-phone-landscape) #instrument_panel {\n        display: block; position: fixed;'));
  assert.ok(html.includes('bottom: 0; height: calc(var(--ph-h) + env(safe-area-inset-bottom));'));
});

test('landscape keeps a narrow centred panel between the side stacks', () => {
  assert.ok(html.includes(`${L} #instrument_panel,\n      .bp-phone-landscape #instrument_panel {\n        display: block;`));
  assert.ok(html.includes('left: calc(var(--tc-in) + 124px + env(safe-area-inset-left));'));
  assert.ok(html.includes('right: calc(var(--tc-in) + 132px + env(safe-area-inset-right));'));
  assert.ok(html.includes('bottom: calc(8px + env(safe-area-inset-bottom)); height: var(--ph-h);'));
  // Not the full-bleed landscape panel from the first #183 pass.
  assert.ok(!html.includes(`${L} #instrument_panel {\n        display: block; left: calc(6px + env(safe-area-inset-left)); right: calc(6px + env(safe-area-inset-right));\n        bottom: 0;`));
});

test('portrait Overlay steers are narrow side gutters matching the two button rows', () => {
  assert.ok(html.includes('--tc-steer-w: 52px'));
  assert.ok(html.includes('--tc-round: 44px'));
  assert.ok(html.includes('.bp-phone:not(.bp-phone-landscape) body.tc-overlay .tc-steer {\n        top: auto;\n        left: calc(8px + env(safe-area-inset-left));\n        bottom: calc(var(--ph-h) + var(--tc-pad) + env(safe-area-inset-bottom));\n        width: var(--tc-steer-w); height: var(--tc-steer-h);'));
  assert.ok(html.includes('--tc-steer-h: 190px'));
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
