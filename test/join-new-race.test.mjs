// The first boat into a room whose race ended (idle) starts a new race on a
// fresh core (Room.newRace('join')). Regression for two bugs seen on
// sailzone.app: the joining boat was not drawn until a reload (the new core's
// statics versions restarted at 0 and collided with the old core's, so the
// server skipped sending the new statics), and it spawned in the middle of
// the map (spawned before the scenario set up its start line).
import './dom-stub.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../apps/server/room.js';
import { clearReplays } from '../apps/server/replays.js';
import { parseServerMessage } from '../src/wire-codec.js';

const mute = (f) => { const l = console.log; const i = console.info; console.log = () => {}; console.info = () => {}; try { return f(); } finally { console.log = l; console.info = i; } };

test('joining an idle room: the boat is sent in the statics and spawns below the start line', (t) => {
  clearReplays();
  const room = new Room('join-race', { graceMs: 0 });
  // The client's view: the last statics message it got (remote-host.js).
  let statics = null;
  let sv = null;
  let own = [];
  const chat = [];
  const c = { send(s) { const m = parseServerMessage(s); if (m.type === 'statics') { statics = m.statics; sv = m.sv; } if (m.type === 'event' && m.ev.type === 'ownBoats') own = m.ev.boats; if (m.type === 'event' && m.ev.type === 'chat') chat.push(m.ev.msg.text); } };
  room.join(c);
  room.stop();
  t.after(() => { room.leave(c); room.stop(); });
  mute(() => room.message(c, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '4f' } }));
  room.stop();
  mute(() => room.applyTomlConfig(room.defaultTomlConfig()));
  for (let i = 0; i < 10; i++) mute(() => room.step());
  // The race ends with nobody sailing (the idle cutoff).
  mute(() => room._endRace('idle'));
  assert.equal(room._recorder, null);
  // The live clock computes a tick at the start of its slot and publishes it
  // at the end (_start); the join lands in between.
  const out = mute(() => room._compute());
  mute(() => room.message(c, { type: 'command', id: 1, c: { type: 'spawnBoat', name: 'Me' } }));
  mute(() => room._publish(out));
  for (let i = 0; i < 30; i++) mute(() => room.step());
  assert.equal(own.length, 1, 'the client owns its boat');
  const id = own[0].id;
  assert.ok(chat.some((x) => /^Me joined \(boat \d+\)$/.test(x)), 'join posted in chat: ' + JSON.stringify(chat));
  const boat = room.core.sim.players.find((b) => b.spawnId === id);
  assert.ok(boat, 'boat is on the current core');
  assert.equal(sv, room.core.staticsVersion, 'client holds the current core statics version');
  assert.deepEqual(Object.keys(statics.hulls || {}), Object.keys(room.core.statics.hulls || {}));
  assert.equal(statics.bodies.length, room.core.statics.bodies.length);
  assert.ok(statics.hulls && statics.hulls[id], 'the boat hull is in the client statics');
  // Below the start line (on the side away from the course), not mid-map.
  const line = room.core.sim.startSequence && room.core.sim.startSequence.line;
  assert.ok(line, 'the scenario has a start line');
  assert.ok(boat.y < line.mid.y, `boat y ${boat.y.toFixed(1)} below the line at ${line.mid.y}`);
});
