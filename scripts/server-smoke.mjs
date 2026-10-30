// CI smoke test for the built sim server: start dist-server/server.mjs,
// connect one RemoteHost client, load scenario 0, let it run ~2 s and check
// frames, readout and field grids arrive (the client turns the field on). Run `npm run build:server` first.
import { hudFromState } from '../src/hud.js';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { RemoteHost } from '../src/remote-host.js';

const port = 8700 + Math.floor(Math.random() * 200);
const srv = spawn(process.execPath, ['dist-server/server.mjs', '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, ADMIN_SECRET: 'smoke-admin' } });
const fail = (msg) => { console.error('FAIL ' + msg); srv.kill(); process.exit(1); };
setTimeout(() => fail('timeout'), 60000).unref();
await new Promise((resolve) => srv.stdout.on('data', (d) => { process.stdout.write(d); if (String(d).includes('listening')) resolve(); }));

const tex = { image: { data: new Uint8Array(0) } };
const host = new RemoteHost(`ws://127.0.0.1:${port}/ws?room=europe-1`, { mapW: 100, mapH: 200, simRes: '4f' }, tex, { WebSocketImpl: WebSocket, adminSecret: 'smoke-admin' });
const info = await host.ready.catch((e) => fail(String(e)));
host.setField({ on: true });
console.log('info: mode', info.mode, 'map', info.mapW + 'x' + info.mapH, 'scenarios', info.scenarios.length);
const card = await host.command({ type: 'restart', scenario: 0 });
console.log('scenario 0:', card && card.title);
await new Promise((r) => setTimeout(r, 2000));
const f = host.lastFrame;
const ok = host.framesReceived >= 30 && f && f.state && /Boat 0 TWA/.test(hudFromState(f.state.hud).info) && f.boat0 && Number.isFinite(f.boat0.x) && host.fieldsReceived > 0;
console.log(`frames ${host.framesReceived}, fields ${host.fieldsReceived} (${host.lastField ? host.lastField.grids.length + ' grids, ' + host.fieldBytes / host.fieldsReceived + ' B each, ' : ''}texture ${tex.image.width}x${tex.image.height}), boat0 ${f && f.boat0 && f.boat0.x.toFixed(2)},${f && f.boat0 && f.boat0.y.toFixed(2)}`);
const status = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
console.log('status', JSON.stringify(status));
const list = await (await fetch(`http://127.0.0.1:${port}/api/rooms`)).json();
console.log('rooms', JSON.stringify(list));
if (!(list.length === 1 && list[0].id === 'europe-1' && list[0].players === 1)) fail('/api/rooms');
host.terminate();
srv.kill();
if (!ok) fail('no frames / readout / field');
console.log('server smoke passed');
process.exit(0);
