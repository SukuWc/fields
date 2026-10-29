// A boat sails the example custom (TOML) course end to end: starts after the
// gun, rounds w1 to port and passes the leeward gate on both laps, then
// finishes. The boat is moved along a fixed path (no steering), so this
// checks the start / course / finish wiring of custom-scenario.js, not
// boat handling. Usage: node --import ./test/register.mjs scripts/custom-scenario-check.mjs
import { SimCore } from '../src/host.js';
import { parseAndValidateRoomConfig } from '../src/room-config.js';
import { EXAMPLE_CUSTOM_TOML } from '../test/custom-scenario-example.mjs';

const say = console.log;
console.log = () => {};
let failed = 0;
const check = (name, ok, extra = '') => { say((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f' });
const p = parseAndValidateRoomConfig(EXAMPLE_CUSTOM_TOML, { core });
if (p.error) { say('FAIL  example: ' + p.error); process.exit(1); }
core.command({ type: 'config', config: p.config });
const tick = () => core.tick({ dt: 1 / 30, held: [], present: false, view: {} });
for (let i = 0; i < 3; i++) tick();
const sim = core.sim;
const { id } = core.command({ type: 'spawnBoat', name: 'Ann' });
const boat = sim.players.find((b) => b.spawnId === id);
const seq = sim.startSequence;
const progress = () => sim.course.progressFor(boat);

tick();
check('not started before the gun', !seq.hasStarted(boat) && progress().waitingForStart);

const body = boat.physics_model;
const put = (x, y) => { body.setPosition({ x, y }); body.setLinearVelocity({ x: 0, y: 0 }); body.setAngularVelocity(0); };
let at = [boat.x, boat.y];
const sail = (x, y) => {
  const [x0, y0] = at;
  const n = Math.ceil(Math.hypot(x - x0, y - y0) / 0.75);
  body.setAngle(Math.atan2(y - y0, x - x0) - Math.PI / 2);
  for (let k = 1; k <= n; k++) { put(x0 + (x - x0) * k / n, y0 + (y - y0) * k / n); tick(); }
  at = [x, y];
};
// Round w1 (8, 60) to port: up its east side, across the top, down the west.
const roundW1 = (fromX) => { sail(fromX, 40); sail(11, 50); sail(11, 64); sail(5, 64); sail(5, 50); };
// Gate g2w (2, -50) – g2e (14, -50): down through the middle, then out east.
const gate = () => { sail(8, -40); sail(8, -62); sail(20, -62); };

// Wait below the line (bow clear of it), jump the clock to the gun, cross.
sail(8, -76);
seq.clock = -0.2;
for (let i = 0; i < 10; i++) tick();
check('gun has gone', seq.clock > 0);
sail(8, -60);
check('started across the line after the gun', seq.hasStarted(boat));
roundW1(11);
check('lap 1: w1 rounded', progress().target === 1, 'target ' + progress().target);
gate();
check('lap 1: gate passed', progress().target === 2, 'target ' + progress().target);
roundW1(20);
gate();
check('lap 2 done, finish next', progress().courseComplete && progress().target === 4, 'target ' + progress().target);
check('not finished before the line', !sim.raceResults.isFinished(boat));
sail(20, -10);
check('finished across fb–fp', sim.raceResults.isFinished(boat));
const e = sim.raceResults.entryFor(boat);
check('result: position 1, positive elapsed', e && e.position === 1 && e.elapsed > 0, JSON.stringify(e && { position: e.position, elapsed: e.elapsed }));
check('boat stayed inside the boundary', !sim.boundary.crossings.length);

console.log = say;
if (failed) { console.log(failed + ' failed'); process.exit(1); }
console.log('custom-scenario-check: all passed');
