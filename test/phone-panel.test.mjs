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

// Two rows on phones and tablets (pt130u): the head row plus two rows of
// tiles or chart strips fit --ph-h; extra columns scroll sideways as one block.
test('phone Readout and Chart lay out as two rows, column first, scrolling sideways together', () => {
  assert.match(html, /\.bp-phone body \{\s*\/\*[^*]*\*\/\s*--ph-h: 162px;/);
  assert.match(html, /\.bp-phone-landscape body \{\s*--ph-h: 162px;/);
  const tiles = html.match(/\.bp-phone #instrument_panel:not\(\[data-mode="chart"\]\) \.instr-tiles \{([^}]*)\}/)[1];
  for (const d of ['display: grid', 'grid-template-columns: none', 'grid-template-rows: repeat(2, auto)', 'grid-auto-flow: column', 'grid-auto-columns: minmax(52px, 1fr)', 'overflow-x: auto']) assert.ok(tiles.includes(d), d);
  const charts = html.match(/\.bp-phone #instrument_panel\[data-mode="chart"\] \.instr-charts \{([^}]*)\}/)[1];
  for (const d of ['display: grid', 'grid-template-columns: none', 'grid-template-rows: repeat(2, auto)', 'grid-auto-flow: column', 'grid-auto-columns: calc(50% - 3px)', 'overflow-x: auto']) assert.ok(charts.includes(d), d);
  assert.ok(html.includes('.bp-phone-landscape #instrument_panel[data-mode="chart"] .instr-charts { grid-auto-columns: 100%; }'));
  assert.ok(html.includes('.bp-phone #instrument_panel .instr-tile .instr-label { white-space: nowrap;'), 'one-line tile labels');
  // phones show 12 tiles (4 are in the top strip): 6 columns of two
  assert.equal(READOUT_TILES.length - STRIP_CELLS.length, 12);
});

test('tablet: tiles 8 per row and strips 4 per row (two rows each); desktop strips 4 per row from 150 px', () => {
  assert.ok(html.includes('.bp-tablet #instrument_panel .instr-tiles { grid-template-columns: repeat(8, 1fr); }'));
  assert.ok(html.includes('.bp-tablet #instrument_panel[data-mode="chart"] .instr-charts { grid-template-columns: repeat(4, minmax(0, 1fr)); }'));
  assert.ok(html.includes('.bp-desktop #hud_grid #instrument_panel[data-mode="chart"] .instr-charts { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }'));
});

test('narrow landscape: tighter mode tabs so tabs plus the window selector fit', () => {
  assert.ok(html.includes('.bp-phone-landscape #instrument_panel .instr-mode { padding: 0 4px; }'));
  assert.ok(html.includes('.bp-phone-landscape #instrument_panel .instr-window { padding: 0 2px; }'));
});
