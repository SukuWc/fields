// Room wind in the instrument panel (instrument-readout.js roomWindValues,
// instrument-chart.js room lines and the circular TWD strip).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { READOUT_TILES, readoutValues, roomWindValues, formatReadout, compassPoint, signedDeg } from '../src/instrument-readout.js';
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
  assert.equal(formatReadout('rwd', 359), '-1');
  assert.equal(formatReadout('rwd', 200), '-160');
  assert.equal(formatReadout('twd', 359), '359', 'TWD stays 0–359');
  assert.equal(formatReadout('rwd', null), '–');
  assert.equal(compassPoint(0), 'N'); assert.equal(compassPoint(22.5), 'NNE'); assert.equal(compassPoint(359), 'N'); assert.equal(compassPoint(250), 'WSW');
  assert.equal(compassPoint(NaN), '');
  assert.match(html, /\.instr-tile\.instr-room \{/);
});

test('signedDeg: room wind direction as a signed angle in (-180, 180]', () => {
  assert.equal(signedDeg(359), -1);
  assert.equal(signedDeg(180), 180);
  assert.equal(signedDeg(181), -179);
  assert.equal(signedDeg(-180), 180);
  assert.equal(signedDeg(0), 0);
  assert.ok(Object.is(signedDeg(-0), 0), '-0 reads 0');
  assert.ok(Object.is(signedDeg(-0.3), 0), '-0.3 rounds to 0, not -0');
  assert.ok(Object.is(signedDeg(359.6), 0), '359.6 rounds to 360 = 0');
  assert.equal(signedDeg(359.4), -1);
  assert.equal(signedDeg(180.4), 180);
  assert.equal(signedDeg(180.6), -179);
  assert.equal(signedDeg(720 + 5), 5);
  assert.equal(signedDeg(-190), 170);
  assert.ok(Number.isNaN(signedDeg(NaN)) && Number.isNaN(signedDeg(null)));
});

test('ROOM WD and ROOM WS are standalone strips, one line each; local wind strips have no room line', () => {
  assert.deepEqual(CHART_STRIPS.map((s) => s.key), ['speed', 'twa', 'wind', 'rws', 'twd', 'rwd', 'heading']);
  assert.deepEqual(strip('wind').lines.map((l) => l.key), ['tws', 'aws']);
  assert.deepEqual(strip('twd').lines.map((l) => l.key), ['twd']);
  assert.deepEqual(strip('rwd').lines.map((l) => l.key), ['rwd']);
  assert.deepEqual(strip('rws').lines.map((l) => l.key), ['rws']);
  assert.equal(strip('rwd').label, 'ROOM WD'); assert.equal(strip('rws').label, 'ROOM WS');
  assert.ok(strip('rwd').circular && strip('rwd').signed && !strip('twd').signed);
  assert.equal(strip('rws').min, 0);
  const b = new ChartBuffer();
  for (let i = 0; i < 50; i++) b.add(i * 0.2, { boatId: null, rwd: 2, rws: 4.5 });
  const p = stripPolylines(b, strip('rws'), { windowS: 10, w: 300, h: 34 });
  assert.equal(p.lines.length, 1);
  assert.equal(p.lines[0].pts.length, 1, 'room line drawn without a boat (spectator)');
  assert.equal(stripPolylines(b, strip('wind'), { windowS: 10, w: 300, h: 34 }).lines[0].pts.length, 0);
  assert.match(chartHoverAt(b, strip('rws'), { windowS: 10, w: 300, h: 34, x: 300 }).text, /^ROOM WS 4\.5 m\/s · now$/);
});

test('ROOM WD strip: circular, no 0/360 jump, fitted range, signed labels and tooltip', () => {
  assert.ok(Math.abs(circularMean([[350, 10]]) - 0) < 1e-6 || Math.abs(circularMean([[350, 10]]) - 360) < 1e-6);
  const b = new ChartBuffer();
  // room wind oscillating around north: 354..6
  for (let i = 0; i < 100; i++) b.add(i * 0.2, { boatId: 'a', twd: (360 + 8 * Math.sin(i / 10)) % 360, rwd: (360 + 6 * Math.sin(i / 10)) % 360 });
  const p = stripPolylines(b, strip('rwd'), { windowS: 20, w: 300, h: 34 });
  assert.ok(p.hi - p.lo >= 20 && p.hi - p.lo <= 30, `${p.lo}..${p.hi}`);
  assert.ok(p.lo < p.mid && p.mid < p.hi);
  assert.equal(p.lines[0].pts.length, 1, 'one unbroken room line across north');
  assert.equal(stripPolylines(b, strip('twd'), { windowS: 20, w: 300, h: 34 }).lines[0].pts.length, 1, 'TWD too');
  assert.match(formatChartValue(strip('rwd'), p.lo), /^-\d+$/, 'axis label below north is negative');
  assert.equal(formatChartValue(strip('rwd'), -5), '-5');
  assert.equal(formatChartValue(strip('rwd'), 355), '-5');
  assert.equal(formatChartValue(strip('rwd'), 365), '5');
  assert.equal(formatChartValue(strip('twd'), -5), '355', 'TWD keeps 0–359');
  b.add(20, { boatId: 'a', twd: 359, rwd: 359 });
  const h = chartHoverAt(b, strip('rwd'), { windowS: 20, w: 300, h: 34, x: 300 });
  assert.equal(h.text, 'ROOM WD -1 ° · now');
  assert.ok(h.values.every((v) => v.y >= 0 && v.y <= 34));
  // a steady wind still gets a readable (20°) range
  const s = new ChartBuffer();
  for (let i = 0; i < 20; i++) s.add(i * 0.2, { boatId: 'a', twd: 90, rwd: 90 });
  const q = stripPolylines(s, strip('rwd'), { windowS: 10, w: 300, h: 34 });
  assert.ok(q.lo <= 80 && q.hi >= 100 && q.hi - q.lo <= 30, `${q.lo}..${q.hi}`);
});
