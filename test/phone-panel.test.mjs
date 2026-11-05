import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READOUT_TILES } from '../src/instrument-readout.js';
import { STRIP_CELLS } from '../src/mobile-strip.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const P = '.bp-phone:not(.bp-phone-landscape)';
const L = '.bp-phone-landscape body.touch-on.tc-overlay';

test('phones show the shared instrument panel above the controls', () => {
  assert.ok(html.includes(`${P} #instrument_panel {\n        display: block;`));
  assert.ok(html.includes(`${P} body.touch-on #instrument_panel { bottom: calc(var(--touch-panel-h) + 6px); }`));
  assert.ok(html.includes(`${L} #instrument_panel {\n        display: block;`));
  // Overlay steer zones move up by the panel height so nothing overlaps.
  assert.ok(html.includes(`${P} body.tc-overlay .tc-steer { bottom: calc(var(--touch-panel-h) + 60px + var(--ph-h))`));
  // Chart mode hides the tiles on phones too.
  assert.ok(html.includes(`${P} #instrument_panel:not([data-mode="chart"]) .instr-tiles`));
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
