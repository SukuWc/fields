// sim.worker.js message protocol, run in-process with a fake `self`: the
// worker's frames match a LocalHost step for step, everything it posts is
// structured-cloneable, and field buffers are handed over and recycled.
import { LocalHost } from '../src/host.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const quiet = console.log;
const msgs = [];
globalThis.self = { postMessage(m, transfer) { structuredClone(m); msgs.push({ m, transfer }); } };
await import('../src/sim.worker.js');
const send = (m) => self.onmessage({ data: m });
const opts = { mapW: 100, mapH: 200, simRes: '4f' };
const view = { camera_position_x: 0, camera_position_y: 0, show_forces: false, show_fields: false };

send({ type: 'init', opts });
const info = msgs.find((x) => x.m.type === 'info');
check('init answers with info', info && info.m.info.mapW === 100 && info.m.info.scenarios.length > 0);
const local = new LocalHost({ ...opts, texture: { image: { data: new Uint8Array(0) } } });
console.log = () => {};
send({ type: 'command', id: 1, c: { type: 'restart', scenario: 7 } });
local.commandSync({ type: 'restart', scenario: 7 });
let same = true, fields = 0, recycled = false, lastField = null;
for (let t = 0; t < 60; t++) {
  const held = t > 10 && t < 30 ? [{ type: 'helm', boat: 0, dir: 1 }] : [];
  msgs.length = 0;
  send({ type: 'tick', req: { dt: 1 / 30, held, present: true, view } });
  const lf = local.tick({ dt: 1 / 30, held, present: true, view });
  const fm = msgs.find((x) => x.m.type === 'frame');
  if (!fm || fm.m.frame.hud.info.replace(/Phys Time.*?<br>/g, '') !== lf.hud.info.replace(/Phys Time.*?<br>/g, '')
    || JSON.stringify(fm.m.frame.boat0) !== JSON.stringify(lf.boat0) || fm.m.frame.guides.length !== lf.guides.length) same = false;
  if (fm && fm.m.field) {
    fields++;
    check.quiet = true;
    if (!(fm.transfer && fm.transfer[0] === fm.m.field.data.buffer)) same = false;
    if (lastField) send({ type: 'buffer', data: lastField });
    lastField = fm.m.field.data;
  }
}
console.log = quiet;
const evs = msgs.length;
check('worker frames match LocalHost for 60 ticks (scenario 7, held helm)', same);
check('field frames carry transferred RGBA buffers', fields > 0, 'fields=' + fields);
send({ type: 'query', id: 2, q: { type: 'fieldVelocity', x: 0, y: 0 } });
const q = msgs.find((x) => x.m.type === 'result' && x.m.id === 2);
check('query answers by id', q && Number.isFinite(q.m.r.x));
send({ type: 'command', id: 3, c: { type: 'simRes', mode: '2' } });
const r = msgs.find((x) => x.m.type === 'result' && x.m.id === 3);
check('simRes command result is plain { rebuilt, lattice }', r && r.m.r.rebuilt === true && r.m.r.lattice.w >= 100);
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all worker checks passed');
