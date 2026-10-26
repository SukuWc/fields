// Frame-time history (apps/server/frame-times.js) and GET /api/perf:
// buffer trim, physics+field in frameMs, API shape / CORS.
import { WebSocket } from 'ws';
import { FrameTimeHistory, FRAME_TIME_CAP, FRAME_TIME_WINDOW_S, FRAME_TIME_HZ } from '../apps/server/frame-times.js';
import { Room } from '../apps/server/room.js';
import { startServer } from '../apps/server/index.js';

let failed = 0;
const quiet = console.log;
const check = (name, ok, extra = '') => { quiet((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
console.log = () => {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

check('cap is 180 s × 30 Hz', FRAME_TIME_CAP === FRAME_TIME_WINDOW_S * FRAME_TIME_HZ && FRAME_TIME_CAP === 5400);

{
  const h = new FrameTimeHistory({ capacity: 5, sampleHz: 30, windowS: 180 });
  check('empty snapshot', h.length === 0 && h.snapshot().times.length === 0 && h.snapshot().endAt === null && h.snapshot().latestMs === null);
  for (let i = 1; i <= 3; i++) h.push(i * 10, 1000 + i);
  let s = h.snapshot();
  check('grows oldest→newest', s.times.join() === '10,20,30' && s.latestMs === 30 && s.endAt === 1003, JSON.stringify(s));
  h.push(40, 1004); h.push(50, 1005); h.push(60, 1006);
  s = h.snapshot();
  check('trims to capacity (ring)', h.length === 5 && s.times.join() === '20,30,40,50,60' && s.latestMs === 60 && s.endAt === 1006, JSON.stringify(s));
  check('snapshot meta', s.sampleHz === 30 && s.windowS === 180);
}

// Room._compute: frameMs ≥ tickMs and includes field encode when due.
{
  const room = new Room('ft', { lockstep: true, fieldHz: 30, graceMs: 0 });
  const client = { send() {}, bufferedAmount: 0 };
  room.join(client);
  room.message(client, { type: 'init', opts: { mapW: 50, mapH: 100, simRes: '2f', scenario: 0 } });
  room._setField(client, { on: true, plotType: 3, contrastExp: 0 });
  // Force field due every tick (fieldSkip 0).
  room.core.settings.fieldSkip = 0;
  const before = room.frameTimes.length;
  room.step({ dt: 1 / 30, held: [], present: true, view: { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false } });
  check('one sample per completed tick', room.frameTimes.length === before + 1);
  check('frameMs includes field encode (≥ tickMs, and encode ran)', room.frameMs >= room.tickMs && room.fieldEncodes >= 1 && room.frameMs > 0,
    `frameMs ${room.frameMs} tickMs ${room.tickMs} encodes ${room.fieldEncodes}`);
  // No dt → no tick advance / no sample (present-only style not used; skip by calling _compute with no dt via query path — use step with undefined dt omitted)
  const n1 = room.frameTimes.length;
  // Lockstep with dt still records; pause path: stop clock means no pushes — covered by empty buffer at startup.
  check('history snapshot matches length', room.frameTimes.snapshot().times.length === n1);
  room.stop();
}

// GET /api/perf
{
  const srv = await startServer({ port: 0, host: '127.0.0.1', fixedRooms: ['europe-1'], graceMs: 0, fieldHz: 30 });
  const base = `http://127.0.0.1:${srv.port}`;
  const empty = await fetch(base + '/api/perf');
  check('/api/perf CORS *', empty.headers.get('access-control-allow-origin') === '*');
  const body0 = await empty.json();
  check('/api/perf shape at startup (empty history)', Array.isArray(body0.rooms) && body0.rooms.length === 1
    && body0.rooms[0].id === 'europe-1' && body0.rooms[0].players === 0
    && body0.rooms[0].sampleHz === 30 && body0.rooms[0].windowS === 180
    && Array.isArray(body0.rooms[0].times) && body0.rooms[0].times.length === 0
    && body0.rooms[0].latestMs === null && body0.rooms[0].endAt === null,
    JSON.stringify(body0));

  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/?room=europe-1`);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws timeout')), 5000);
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.type === 'welcome') { clearTimeout(t); resolve(); }
    });
    ws.on('open', () => ws.send(JSON.stringify({ type: 'init', opts: { mapW: 50, mapH: 100, simRes: '2f', scenario: 0 } })));
    ws.on('error', reject);
  });
  await sleep(250);
  const body1 = await (await fetch(base + '/api/perf')).json();
  const r = body1.rooms[0];
  check('/api/perf fills while the room is running', r.players === 1 && r.times.length >= 3 && r.latestMs != null && r.endAt != null,
    `n=${r.times.length} latest=${r.latestMs}`);
  check('/api/rooms still works', JSON.stringify(await (await fetch(base + '/api/rooms')).json()) === '[{"id":"europe-1","players":1}]');

  // Two rooms in the payload when configured.
  const srv2 = await startServer({ port: 0, host: '127.0.0.1', fixedRooms: ['a', 'b'], graceMs: 0, fieldHz: 0 });
  const p2 = await (await fetch(`http://127.0.0.1:${srv2.port}/api/perf`)).json();
  check('/api/perf lists every fixed room', p2.rooms.map((x) => x.id).join() === 'a,b', JSON.stringify(p2.rooms.map((x) => x.id)));
  await srv2.close();

  ws.close();
  await srv.close();
}

console.log = quiet;
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all frame-times checks passed');
process.exit(0);
