// Room wind in the instrument panel (instrument-readout.js roomWindValues,
// instrument-chart.js room lines and the circular TWD strip).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READOUT_TILES, readoutValues, roomWindValues, formatReadout, compassPoint } from '../src/instrument-readout.js';
import { ChartBuffer, CHART_STRIPS, stripPolylines, chartHoverAt, formatChartValue, circularMean } from '../src/instrument-chart.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const strip = (k) => CHART_STRIPS.find((s) => s.key === k);

test('room wind values come from state.rw, with or without a boat', () => {
  assert.deepEqual(roomWindValues({ rw: [365.5, 4.46] }), { rwd: 5.5, rws: 4.46 });
  assert.deepEqual(roomWindValues({}), { rwd: null, rws: null });
  assert.deepEqual(roomWindValues(null), { rwd: null, rws: null });
  const state = { boats: [{ id: 'b0', twd_deg: 20, tws_ms: 3.1 }], rw: [10, 4.5] };
  const v = readoutValues(state, {});
  assert.equal(v.twd, 20, 'TWD stays the wind at the boat');
  assert.equal(v.tws, 3.1);
  assert.equal(v.rwd, 10);
  assert.equal(v.rws, 4.5);
});

test('ROOM WD / ROOM WS tiles beside TWD / TWS, formatted like them', () => {
  const keys = READOUT_TILES.map((t) => t.key);
  assert.equal(keys.indexOf('rwd'), keys.indexOf('tws') + 1);
  assert.equal(keys.indexOf('rws'), keys.indexOf('rwd') + 1);
  const rwd = READOUT_TILES.find((t) => t.key === 'rwd');
  const rws = READOUT_TILES.find((t) => t.key === 'rws');
  assert.equal(rwd.label, 'ROOM WD'); assert.equal(rwd.unit, '°'); assert.ok(rwd.room);
  assert.equal(rws.label, 'ROOM WS'); assert.equal(rws.unit, 'm/s'); assert.ok(rws.room);
  assert.equal(formatReadout('rws', 4.46), '4.5');
  assert.equal(formatReadout('rwd', 359.7), '0');
  assert.equal(formatReadout('rwd', null), '–');
  assert.equal(compassPoint(0), 'N'); assert.equal(compassPoint(22.5), 'NNE'); assert.equal(compassPoint(359), 'N'); assert.equal(compassPoint(250), 'WSW');
  assert.equal(compassPoint(NaN), '');
  assert.match(html, /\.instr-tile\.instr-room \{/);
});

test('room wind is a dashed line on the local wind strips', () => {
  assert.deepEqual(strip('wind').lines.map((l) => l.key), ['tws', 'aws', 'rws']);
  assert.deepEqual(strip('twd').lines.map((l) => l.key), ['twd', 'rwd']);
  for (const k of ['wind', 'twd']) assert.ok(strip(k).lines.at(-1).dash, k);
  assert.ok(!strip('wind').lines[0].dash);
  const b = new ChartBuffer();
  for (let i = 0; i < 50; i++) b.add(i * 0.2, { boatId: null, rwd: 2, rws: 4.5 });
  const p = stripPolylines(b, strip('wind'), { windowS: 10, w: 300, h: 34 });
  assert.equal(p.lines[2].dash, strip('wind').lines[2].dash);
  assert.equal(p.lines[2].pts.length, 1, 'room line drawn without a boat (spectator)');
  assert.equal(p.lines[0].pts.length, 0);
});

test('TWD / ROOM strip is circular: no 0/360 jump, fitted range, wrapped labels', () => {
  assert.ok(Math.abs(circularMean([[350, 10]]) - 0) < 1e-6 || Math.abs(circularMean([[350, 10]]) - 360) < 1e-6);
  const b = new ChartBuffer();
  // room wind oscillating around north: 354..6
  for (let i = 0; i < 100; i++) b.add(i * 0.2, { boatId: 'a', twd: (360 + 8 * Math.sin(i / 10)) % 360, rwd: (360 + 6 * Math.sin(i / 10)) % 360 });
  const p = stripPolylines(b, strip('twd'), { windowS: 20, w: 300, h: 34 });
  assert.ok(p.hi - p.lo >= 20 && p.hi - p.lo <= 30, `${p.lo}..${p.hi}`);
  assert.ok(p.lo < p.mid && p.mid < p.hi);
  assert.equal(p.lines[0].pts.length, 1, 'one unbroken TWD line across north');
  assert.equal(p.lines[1].pts.length, 1, 'one unbroken room line across north');
  assert.equal(formatChartValue(strip('twd'), -5), '355');
  assert.equal(formatChartValue(strip('twd'), 365), '5');
  const h = chartHoverAt(b, strip('twd'), { windowS: 20, w: 300, h: 34, x: 300 });
  assert.match(h.text, /^TWD \d+ · ROOM WD \d+ ° · now$/);
  assert.ok(h.values.every((v) => v.y >= 0 && v.y <= 34));
  // a steady wind still gets a readable (20°) range
  const s = new ChartBuffer();
  for (let i = 0; i < 20; i++) s.add(i * 0.2, { boatId: 'a', twd: 90, rwd: 90 });
  const q = stripPolylines(s, strip('twd'), { windowS: 10, w: 300, h: 34 });
  assert.ok(q.lo <= 80 && q.hi >= 100 && q.hi - q.lo <= 30, `${q.lo}..${q.hi}`);
});
