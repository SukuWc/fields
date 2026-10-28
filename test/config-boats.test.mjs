// Room TOML config commit (apps/server/room.js): a config apply that restarts
// the room must keep each connected client at exactly one player boat. Old
// boats are destroyed; a join during the restart→respawn window must not
// leave an orphan beside the kept boat.
import { Room } from '../apps/server/room.js';
import { configFromRoomState } from '../src/room-config.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};

const client = () => { const c = { got: [], send(s) { c.got.push(JSON.parse(s)); } }; return c; };
const spawned = (room) => room.core.sim.players.filter((p) => p.spawnId);
const step = (room, n = 1) => { for (let i = 0; i < n; i++) room.step({ dt: 1 / 30, held: [], present: true, view: {} }); };

{
  const room = new Room('cfg-boats', { lockstep: true, fieldHz: 0, graceMs: 0 });
  const A = client();
  room.join(A);
  room.message(A, { type: 'init', opts: { mapW: 100, mapH: 200, simRes: '4f' } });
  room.message(A, { type: 'command', id: 1, c: { type: 'restart', scenario: 0 } });
  step(room, 3);
  room.message(A, { type: 'command', id: 2, c: { type: 'spawnBoat', name: 'Ann', color: 0xd81b60 } });
  step(room, 1);
  check('joined with one player boat', spawned(room).length === 1 && room.owned.get(A).length === 1, JSON.stringify(spawned(room).map((b) => b.spawnId)));

  for (let round = 1; round <= 4; round++) {
    const cfg = configFromRoomState(room.core.roomState(), { mapW: 100, mapH: 200 });
    cfg.wind_speed_mps = 3 + round * 0.25;
    room.message(A, { type: 'command', id: 10 + round, c: { type: 'config', config: cfg } });
    step(room, 5);
    check('config commit #' + round + ' keeps exactly one player boat',
      spawned(room).length === 1 && room.owned.get(A).length === 1 && room.owned.get(A)[0].name === 'Ann',
      `spawned=${spawned(room).length} owned=${JSON.stringify(room.owned.get(A))}`);
  }

  // Join during the restart→respawn window must not orphan a mid-window boat.
  const cfg = configFromRoomState(room.core.roomState(), { mapW: 100, mapH: 200 });
  cfg.wind_speed_mps = 5.5;
  room.message(A, { type: 'command', id: 50, c: { type: 'config', config: cfg } });
  check('ownership cleared while respawn pending', (room.owned.get(A) || []).length === 0 && !!room._respawn);
  const mid = room._command(A, { type: 'spawnBoat', name: 'Ann', color: 0xd81b60 });
  check('join during respawn window is deferred (no immediate boat)',
    mid && mid.pending === true && spawned(room).length === 0,
    JSON.stringify(mid) + ' spawned=' + spawned(room).length);
  step(room, 5);
  check('after respawnDue: still exactly one boat (no orphan from mid-window join)',
    spawned(room).length === 1 && room.owned.get(A).length === 1,
    `spawned=${spawned(room).map((b) => b.spawnId)} owned=${JSON.stringify(room.owned.get(A))}`);

  // Two clients: each keeps one across config.
  const B = client();
  room.join(B);
  room.message(B, { type: 'init', opts: {} });
  room.message(B, { type: 'command', id: 60, c: { type: 'spawnBoat', name: 'Bo', color: 0x1e88e5 } });
  step(room, 1);
  const cfg2 = configFromRoomState(room.core.roomState(), { mapW: 100, mapH: 200 });
  cfg2.wind_speed_mps = 6;
  room.message(A, { type: 'command', id: 61, c: { type: 'config', config: cfg2 } });
  step(room, 5);
  check('two clients: one player boat each after config',
    spawned(room).length === 2
      && (room.owned.get(A) || []).length === 1
      && (room.owned.get(B) || []).length === 1,
    `spawned=${spawned(room).length} A=${JSON.stringify(room.owned.get(A))} B=${JSON.stringify(room.owned.get(B))}`);
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all config-boat checks passed');
process.exit(0);
