// Browser replay player (?replay=<id>): the shared stepping
// (src/replay-stepper.js) reproduces a live sailzone.app race
// (test/fixtures/replay-europe-1-mww066n9-1.json, GET /api/replays/<id> on
// 2026-11-25) hash for hash, ReplayHost plays it through the SimHost
// interface without letting the page change it, and the landing page builds
// the per-room replay links.
import './dom-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ReplayStepper } from '../src/replay-stepper.js';
import { ReplayHost } from '../src/replay-host.js';
import { replayIdFromQuery } from '../src/replay-host.js';
import { replayRecordUrl } from '../src/replay-host.js';
import { replayStatusText } from '../src/replay-host.js';
import { replayLinksFor } from '../apps/landing/room-admin.js';
import { syncReplayLinks } from '../apps/landing/room-admin.js';
import { REPLAY_LINKS_MAX } from '../apps/landing/room-admin.js';

const RECORD = JSON.parse(fs.readFileSync(new URL('./fixtures/replay-europe-1-mww066n9-1.json', import.meta.url), 'utf8'));
const mute = (f) => { const l = console.log; const i = console.info; console.log = () => {}; console.info = () => {}; try { return f(); } finally { console.log = l; console.info = i; } };

test('shared stepping reproduces every recorded hash of a live race', () => {
  const s = mute(() => new ReplayStepper(RECORD));
  const r = mute(() => s.run());
  assert.equal(r.firstMismatch, null);
  assert.deepEqual(r.hashes.map((h) => [h.t, h.all]), RECORD.hashes.map((h) => [h.t, h.all]));
  assert.equal(r.finalHash.all, RECORD.finalHash.all);
  assert.equal(r.finalHash.all, 'b8f43d1a0dacaef6');
  assert.equal(s.step(), null, 'nothing left after the end');
});

test('a changed control is caught at the next hash check', () => {
  const bad = structuredClone(RECORD);
  const e = bad.log.find((x) => 'held' in x && x.held.length);
  e.t -= 20;
  const s = mute(() => new ReplayStepper(bad));
  let mismatch = null;
  for (let i = 0; i < e.t + 61 && !mismatch; i++) { mute(() => s.step()); mismatch = s.firstMismatch; }
  assert.ok(mismatch, 'mismatch found');
  assert.ok(mismatch.t > e.t && mismatch.t <= e.t + 60, 'at the first check after the change: ' + mismatch.t);
});

test('ReplayHost plays the record, ignores page input and commands, pauses', async () => {
  const host = new ReplayHost('europe-1-mww066n9-1', { fetchRecord: async (id) => { assert.equal(id, 'europe-1-mww066n9-1'); return RECORD; } });
  assert.equal(host.kind, 'replay');
  const info = await mute(() => host.ready);
  assert.equal(info.mapW, 100);
  assert.equal(info.mapH, 200);
  const statuses = [];
  host.onStatus((st) => statuses.push(st));
  let frames = 0;
  let withState = 0;
  host.onFrame((f) => { frames++; if (f.state && f.statics) withState++; });
  // The page's commands and held keys must not reach the replayed race.
  assert.equal(await host.command({ type: 'restart', scenario: 3 }), undefined);
  assert.equal(host.commandSync({ type: 'autopilotGains', kp: 9 }), undefined);
  const req = { dt: 1 / 30, held: [{ type: 'helm', dir: 1 }], present: true, view: { camera_position_x: 40, show_fields: true } };
  host.setPaused(true);
  assert.equal(host.tick(req), null);
  assert.equal(host.status().t, 0);
  host.setPaused(false);
  assert.equal(host.tick({ ...req, dt: undefined }), null, 'extra passes do nothing');
  mute(() => { for (let i = 0; i < RECORD.ticks + 5; i++) host.tick(req); });
  const st = host.status();
  assert.equal(st.done, true);
  assert.equal(st.mismatch, null);
  assert.equal(st.t, RECORD.ticks);
  assert.equal(st.checked, st.total);
  // Every 30-tick hash plus the final one (tick 1968).
  assert.equal(st.total, RECORD.hashes.length + 1);
  assert.equal(frames, RECORD.ticks);
  assert.equal(withState, RECORD.ticks);
  assert.equal(host.stepper.finalHash.all, RECORD.finalHash.all);
  assert.match(replayStatusText(st), /Replay finished · 66\/66 hashes OK/);
  assert.ok(statuses.some((s) => s.paused));
});

test('ReplayHost reports a missing record', async () => {
  const host = new ReplayHost('nope', { fetchRecord: async () => { throw new Error('replay not found'); } });
  await assert.rejects(host.ready);
  assert.equal(host.status().error, 'replay not found');
  assert.match(replayStatusText(host.status()), /unavailable: replay not found/);
  assert.equal(host.tick({ dt: 1 / 30 }), null);
});

test('replay id and record URL', () => {
  assert.equal(replayIdFromQuery('?replay=europe-1-mww066n9-1'), 'europe-1-mww066n9-1');
  assert.equal(replayIdFromQuery('?room=europe-1'), null);
  assert.equal(replayIdFromQuery('?replay=../../etc'), null);
  assert.equal(replayRecordUrl('europe-1-a-1'), '/api/replays/europe-1-a-1');
  assert.match(replayStatusText({ t: 300, ticks: 1968, checked: 10, total: 65, mismatch: null, done: false, paused: false }), /10\.0 s \/ 65\.6 s · hashes OK 10\/65/);
  assert.match(replayStatusText({ t: 90, ticks: 1968, checked: 3, total: 65, mismatch: { t: 90, want: 'a', got: 'b' } }), /MISMATCH at tick 90/);
});

test('landing replay links: this room, newest first, at most three', () => {
  const list = [
    { id: 'e-4', room: 'europe-1', startedAt: '2026-11-25T11:50:51Z', durationS: 65.6, players: ['suku'] },
    { id: 'x-1', room: 'us-1', startedAt: '2026-11-25T11:40:00Z', durationS: 10, players: [] },
    { id: 'e-3', room: 'europe-1', startedAt: '2026-11-25T11:30:00Z', durationS: 120.2, players: ['a', 'b'] },
    { id: 'e-2', room: 'europe-1', startedAt: 'bad', players: [] },
    { id: 'e-1', room: 'europe-1', startedAt: '2026-11-25T11:00:00Z', durationS: 5, players: [] },
  ];
  const clock = (iso) => (iso === 'bad' ? '' : iso.slice(11, 16));
  const links = replayLinksFor(list, 'europe-1', { clock });
  assert.equal(links.length, REPLAY_LINKS_MAX);
  assert.deepEqual(links.map((l) => l.id), ['e-4', 'e-3', 'e-2']);
  assert.equal(links[0].text, 'Replay 11:50 · 66 s · suku');
  assert.equal(links[0].href, '/play/?replay=e-4');
  assert.equal(links[1].text, 'Replay 11:30 · 120 s · a, b');
  assert.equal(links[2].text, 'Replay');
  assert.equal(replayLinksFor(list, 'us-1', { api: 'https://x.app', clock })[0].href, 'https://x.app/play/?replay=x-1');
  assert.deepEqual(replayLinksFor(null, 'europe-1'), []);
  assert.deepEqual(replayLinksFor(list, 'asia-1'), []);
});

test('landing replay links: DOM untouched while unchanged, hidden when empty', () => {
  const doc = { createElement: () => ({}) };
  const box = { dataset: {}, hidden: true, kids: null, sets: 0, replaceChildren(...k) { this.kids = k; this.sets++; } };
  const links = [{ id: 'a', href: '/play/?replay=a', text: 'Replay 10:00' }];
  assert.equal(syncReplayLinks(box, links, doc), true);
  assert.equal(box.hidden, false);
  assert.equal(box.kids.length, 1);
  assert.equal(box.kids[0].className, 'replay');
  assert.equal(box.kids[0].href, '/play/?replay=a');
  assert.equal(syncReplayLinks(box, links.map((l) => ({ ...l })), doc), false, 'same links: no DOM write');
  assert.equal(box.sets, 1);
  assert.equal(syncReplayLinks(box, [], doc), true);
  assert.equal(box.hidden, true);
  assert.equal(box.kids.length, 0);
});
