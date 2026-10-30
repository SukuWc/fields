// Room admin gate over the WebSocket (apps/server/room.js): with ADMIN_SECRET
// set, room-wide commands (config, restart, wind, …) need a client that
// logged in ('auth' / init adminSecret); with it unset they are refused for
// everyone (read-only, as on the landing page). Boat and chat commands are
// never gated. RemoteHost.login stores the secret under the landing key.
import { WebSocket } from 'ws';
import { startServer } from '../apps/server/index.js';
import { RemoteHost, ADMIN_SECRET_KEY } from '../src/remote-host.js';
import { stringifyRoomConfig, ROOM_CONFIG_BASE } from '../src/room-config.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const opts = { mapW: 100, mapH: 200, simRes: '4f' };
const tex = () => ({ image: { data: new Uint8Array(0) } });
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const mk = (port, extra = {}) => new RemoteHost(`ws://127.0.0.1:${port}/?room=gate`, opts, tex(), { WebSocketImpl: WebSocket, coalesce: false, ...extra });

{
  const srv = await startServer({ port: 0, fieldHz: 0, adminSecret: 's3cret' });
  const a = mk(srv.port);
  await a.ready;
  check('welcome: gate on, enabled, not authed', a.admin && a.admin.gate && a.admin.enabled && !a.admin.authed, JSON.stringify(a.admin));
  const r1 = await a.command({ type: 'restart', scenario: 0 });
  check('restart refused before login', r1 && r1.error === 'admin login required', JSON.stringify(r1));
  const r2 = await a.command({ type: 'wind', speed: 6 });
  check('wind refused before login', r2 && /admin/.test(r2.error || ''), JSON.stringify(r2));
  const sp = await a.command({ type: 'spawnBoat', name: 'Ann' });
  check('spawnBoat not gated', sp && !sp.error, JSON.stringify(sp));
  const bad = await a.login('nope');
  check('wrong secret → unauthorized, not stored', bad && bad.error === 'unauthorized' && !store.has(ADMIN_SECRET_KEY));
  const ok = await a.login('s3cret');
  check('right secret → authed + stored under landing key', ok && ok.ok && a.admin.authed && store.get(ADMIN_SECRET_KEY) === 's3cret', JSON.stringify(ok));
  const toml = stringifyRoomConfig({ ...ROOM_CONFIG_BASE, wind_speed_mps: 5 });
  const { parseAndValidateRoomConfig } = await import('../src/room-config.js');
  const cfg = parseAndValidateRoomConfig(toml, { mapW: 100, mapH: 200 }).config;
  const r3 = await a.command({ type: 'config', config: cfg });
  check('config accepted after login', r3 && !r3.error, JSON.stringify(r3));
  // A second page reads the stored secret (as after a landing login).
  const b = mk(srv.port);
  await b.ready;
  check('second client logged in from localStorage', b.admin && b.admin.authed);
  const c = mk(srv.port, { adminSecret: '' });
  await c.ready;
  const r4 = await c.command({ type: 'config', config: cfg });
  check('client without secret still refused', r4 && r4.error === 'admin login required');
  await a.logout();
  const r5 = await a.command({ type: 'restart', scenario: 0 });
  check('logout → refused again, secret cleared', r5 && r5.error === 'admin login required' && !store.has(ADMIN_SECRET_KEY) && !a.admin.authed);
  for (const h of [a, b, c]) h.close && h.close();
  await srv.close();
}

{
  const srv = await startServer({ port: 0, fieldHz: 0, adminSecret: '' });
  const a = mk(srv.port, { adminSecret: 'whatever' });
  await a.ready;
  check('no ADMIN_SECRET: enabled false', a.admin && a.admin.gate && !a.admin.enabled && !a.admin.authed, JSON.stringify(a.admin));
  const r = await a.command({ type: 'restart', scenario: 0 });
  check('no ADMIN_SECRET: room commands refused (read-only)', r && /disabled/.test(r.error || ''), JSON.stringify(r));
  const l = await a.login('whatever');
  check('no ADMIN_SECRET: login refused', l && /disabled/.test(l.error || ''));
  a.close && a.close();
  await srv.close();
}

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log('all admin-gate checks passed');
process.exit(0);
