// ?field_mode= / ?hud= parsing, checkbox interaction, and nopaint skipping
// paintGrids on RemoteHost (src/field-mode.js, src/remote-host.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimCore } from '../src/host.js';
import { encodeFieldGrids, decodeFieldGrids } from '../src/fieldPainter.js';
import { encodeFieldText } from '../src/field-codec.js';
import { RemoteHost } from '../src/remote-host.js';
import { parseServerMessage } from '../src/wire-codec.js';
import {
  FIELD_MODES,
  fieldModeFromQuery,
  fieldModeState,
} from '../src/field-mode.js';
import { hudFromQuery } from '../src/client-perf-hud.js';

test('fieldModeFromQuery reads recv, freeze, nopaint and ignores the rest', () => {
  assert.equal(fieldModeFromQuery(''), null);
  assert.equal(fieldModeFromQuery('?room=europe-1'), null);
  assert.equal(fieldModeFromQuery('?field_mode='), null);
  assert.equal(fieldModeFromQuery('?field_mode=nope'), null);
  assert.equal(fieldModeFromQuery('?field_mode=recv'), 'recv');
  assert.equal(fieldModeFromQuery('?field_mode=FREEZE'), 'freeze');
  assert.equal(fieldModeFromQuery('?hud=1&field_mode=nopaint'), 'nopaint');
  assert.equal(fieldModeFromQuery(new URLSearchParams('field_mode=recv')), 'recv');
  assert.deepEqual([...FIELD_MODES], ['recv', 'freeze', 'nopaint']);
});

test('hudFromQuery is on only for 1/true/on/yes', () => {
  assert.equal(hudFromQuery(''), false);
  assert.equal(hudFromQuery('?hud=1'), true);
  assert.equal(hudFromQuery('?hud=true'), true);
  assert.equal(hudFromQuery('?HUD=ON'), false); // key is case-sensitive like other query keys
  assert.equal(hudFromQuery('?hud=yes'), true);
  assert.equal(hudFromQuery('?hud=0'), false);
  assert.equal(hudFromQuery('?hud=false'), false);
  assert.equal(hudFromQuery('?hud=maybe'), false);
});

test('fieldModeState: checkbox off (or dev mode) unsubscribes; field_mode only applies while on', () => {
  const off = fieldModeState('recv', { boxOn: false });
  assert.equal(off.subscribe, false);
  assert.equal(off.visible, false);
  assert.equal(off.paint, false);

  const dev = fieldModeState(null, { boxOn: true, devMode: true });
  assert.equal(dev.subscribe, false);
  assert.equal(dev.visible, true);

  const def = fieldModeState(null, { boxOn: true });
  assert.deepEqual(def, { subscribe: true, visible: true, paint: true, freezeAfterPaint: false });

  const recv = fieldModeState('recv', { boxOn: true });
  assert.deepEqual(recv, { subscribe: true, visible: false, paint: true, freezeAfterPaint: false });

  const freeze = fieldModeState('freeze', { boxOn: true, freezeReady: false });
  assert.deepEqual(freeze, { subscribe: true, visible: true, paint: true, freezeAfterPaint: true });
  const frozen = fieldModeState('freeze', { boxOn: true, freezeReady: true });
  assert.deepEqual(frozen, { subscribe: false, visible: true, paint: true, freezeAfterPaint: false });

  const nopaint = fieldModeState('nopaint', { boxOn: true });
  assert.deepEqual(nopaint, { subscribe: true, visible: true, paint: false, freezeAfterPaint: false });
});

const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };

function oneKeyframe() {
  const core = new SimCore({ mapW: 50, mapH: 100, simRes: '2f', oversampling: 8 });
  core.command({ type: 'restart', scenario: 0 });
  core.tick({ dt: 1 / 30, held: [], present: false, view });
  const grids = decodeFieldGrids(encodeFieldGrids(core.bm, { plotType: 3, contrastExp: 0 }));
  return encodeFieldText(grids, 1, null, 0).m;
}

function fakeHost(fieldPaint) {
  class FakeWS { constructor() { this.readyState = 1; this.sent = []; } send(s) { this.sent.push(parseServerMessage(s)); } close() {} }
  const tex = { image: { data: new Uint8Array(0) } };
  const paints = [];
  const h = new RemoteHost('ws://fake', { mapW: 50, mapH: 100, simRes: '2f', oversampling: 8 }, tex, {
    WebSocketImpl: FakeWS,
    coalesce: false,
    fieldPaint,
  });
  h._painter = { paintGrids: (msg) => paints.push(msg) };
  h.ws.onmessage({ data: JSON.stringify({ type: 'info', info: { mode: 'server', scenarios: [] } }) });
  h._field.on = true;
  return { h, paints };
}

function deliverField(h, m) {
  h.ws.onmessage({ data: JSON.stringify(m) });
  h.ws.onmessage({ data: JSON.stringify({ type: 'frame', frame: { tick: 1 } }) });
}

test('RemoteHost paints a delivered keyframe by default', () => {
  const { h, paints } = fakeHost(true);
  deliverField(h, oneKeyframe());
  assert.equal(h.fieldsReceived, 1);
  assert.equal(paints.length, 1);
  assert.ok(h.lastField && h.lastField.grids.length >= 1);
  assert.ok(h.fieldDecodeMs >= 0);
  assert.ok(h.fieldPaintMs >= 0);
  h.terminate();
});

test('RemoteHost fieldPaint=false decodes but skips paintGrids', () => {
  const { h, paints } = fakeHost(false);
  assert.equal(h.fieldPaint, false);
  deliverField(h, oneKeyframe());
  assert.equal(h.fieldsReceived, 1);
  assert.equal(paints.length, 0);
  assert.ok(h.lastField && h.lastField.grids.length >= 1);
  assert.ok(h.fieldDecodeMs >= 0);
  assert.equal(h.fieldPaintMs, 0);
  h.terminate();
});

test('fieldPaint can be toggled after construct (nopaint / default switch)', () => {
  const { h, paints } = fakeHost(true);
  h.fieldPaint = false;
  deliverField(h, oneKeyframe());
  assert.equal(paints.length, 0);
  assert.equal(h.fieldsReceived, 1);
  h.terminate();
});
