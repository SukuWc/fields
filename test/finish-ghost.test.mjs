// Finish ghosts (src/finish-ghost.js): a boat that finishes keeps sailing as a
// ghost: no sail wake into the lattice, raw true wind, collides only with the
// walls, left out of the rules; state.boats[i].gh on every host; drawn faded
// (scene-build / boat-trails); cleared by a new race.
import './dom-stub.mjs';
import { SimCore } from '../src/host.js';
import {
  FINISH_GHOST_CATEGORY, WALL_CATEGORY, FINISH_GHOST_OPACITY, setFinishGhost, racingBoats, desaturate, ghostGuide,
} from '../src/finish-ghost.js';
import { boatTrueWind } from '../src/wind.js';
import { buildScene } from '../src/scene-build.js';
import { BoatTrails } from '../src/boat-trails.js';
import { pendingPenaltyCount } from '../src/rules.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };
const tick = (core, present = false) => mute(() => core.tick({ dt: 1 / 30, held: [], present, view: {} }));

// Scenario 16: both boats already round, a short beat to the finish; boat 1
// finishes first (~22 s).
const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
mute(() => core.command({ type: 'restart', scenario: 16 }));
const sim = core.sim;

tick(core);
const [b0, b1] = sim.players;
let n = 1;
const disks = () => sim.bm.domains.filter((d) => d.disk).length;
const disksBefore = disks();
while (!sim.raceResults.isFinished(b1) && n < 30 * 40) { tick(core); n++; }
check('boat 1 finishes (scenario 16)', sim.raceResults.isFinished(b1), `${(n / 30).toFixed(1)} s`);
check('the finisher is a ghost, the racer is not', b1.finishGhost === true && !b0.finishGhost);
// Refinement: the AMR windows (one disk per boat) stop following the ghost.
for (let i = 0; i < 10; i++) tick(core);
check('AMR: the ghost loses her refinement window, the racer keeps hers', disksBefore === 2 && disks() === 1, `${disksBefore} → ${disks()}`);

// Collisions: walls only.
{
  const f1 = b1.physics_model.getFixtureList();
  const f0 = b0.physics_model.getFixtureList();
  check('ghost fixture filter: category / mask', f1.getFilterCategoryBits() === FINISH_GHOST_CATEGORY && f1.getFilterMaskBits() === WALL_CATEGORY);
  let wall = null;
  for (let body = sim.map.world.getBodyList(); body; body = body.getNext()) {
    for (let f = body.getFixtureList(); f; f = f.getNext()) if (f.getFilterCategoryBits() === WALL_CATEGORY) wall = f;
  }
  const markF = sim.marks[0].physics_model.getFixtureList();
  check('ghost ↔ boat: no collision', !f1.shouldCollide(f0) && !f0.shouldCollide(f1));
  check('ghost ↔ mark: no collision', !f1.shouldCollide(markF) && !markF.shouldCollide(f1));
  check('ghost ↔ wall: still collides', !!wall && f1.shouldCollide(wall) && wall.shouldCollide(f1));
  check('racer ↔ mark and racer ↔ wall unchanged', f0.shouldCollide(markF) && f0.shouldCollide(wall));
}

// No sail wake: the lattice gets nothing from the ghost.
{
  let ghostSegs = 0, racerSegs = 0;
  const g1 = b1.getSailSegments.bind(b1), g0 = b0.getSailSegments.bind(b0);
  b1.getSailSegments = () => { ghostSegs++; return g1(); };
  b0.getSailSegments = () => { racerSegs++; return g0(); };
  for (let i = 0; i < 5; i++) tick(core);
  check('no sail → lattice momentum from the ghost', ghostSegs === 0 && racerSegs === 5, `${ghostSegs} / ${racerSegs}`);
  delete b1.getSailSegments; delete b0.getSailSegments;
  const raw = sim.map.get_wind(b1.x, b1.y);
  const tw = boatTrueWind(b1);
  check('ghost true wind = raw field sample (no own-wake undo)', tw.speed === raw.speed && tw.direction === raw.direction);
}

// Rules: a racer overlapping the ghost gets no contact, no pair, no penalty.
{
  const p1 = b1.physics_model.getPosition();
  b0.physics_model.setPosition({ x: p1.x + 0.5, y: p1.y });
  b0.physics_model.setAngle(b1.physics_model.getAngle() + Math.PI / 2);
  const before = pendingPenaltyCount(b0);
  let pairs = 0;
  for (let i = 0; i < 10; i++) {
    tick(core);
    pairs += sim.last.resolutions.filter((r) => r.boatA === b1 || r.boatB === b1).length;
  }
  check('no rule pairs with the ghost', pairs === 0);
  check('no penalty for touching the ghost', pendingPenaltyCount(b0) === before, `${before} → ${pendingPenaltyCount(b0)}`);
  check('racingBoats drops ghosts only', racingBoats(sim.players).length === 1 && racingBoats(sim.players)[0] === b0);
}

// Frame state and the client scene.
{
  const f = tick(core, true);
  const st = f.state;
  check('state.boats[i].gh on the ghost only', st.boats[1].gh === 1 && st.boats[0].gh === undefined);
  const statics = core.statics;
  const hulls = statics.bodies.filter((e) => e.b != null);
  check('statics: boat hull bodies carry the boat id', hulls.length === 2 && hulls.some((e) => e.b === b1.boatId));
  const scene = buildScene(st, statics, null);
  const gb = scene.bodies.filter((o) => o.gh);
  const k = statics.bodies.findIndex((e) => e.b === b1.boatId);
  check('scene: the ghost hull outline is marked', gb.length === 1 && scene.bodies[k].gh === 1);
  check('ghostGuide fades and greys', ghostGuide({ color: 0xff0000, type: 'sail' }).opacity === FINISH_GHOST_OPACITY && desaturate(0xff0000) !== 0xff0000);
  const tr = new BoatTrails({ interval: 0.1, duration: 10, size: 0.3 });
  const boats = (x, gh) => [{ px: x, py: 0 }, { px: x, py: 5, ...(gh ? { gh: 1 } : {}) }];
  for (let i = 0; i < 20; i++) tr.update(i * 0.1, boats(i * 0.1, i >= 10), 1);
  const per = [0, 0];
  tr.forEachDot((i) => { per[i]++; });
  check('trail: the ghost drops no new dots', per[1] < per[0] && per[1] <= 11, JSON.stringify(per));
}

// Walls: a ghost driven at the map edge stays on the map.
{
  const wallX = sim.map.width / 2 - 2;
  b1.physics_model.setPosition({ x: wallX - 3, y: 0 });
  b1.physics_model.setAngle(Math.PI / 2);
  let maxX = -Infinity;
  for (let i = 0; i < 45; i++) {
    b1.physics_model.setLinearVelocity({ x: 8, y: 0 });
    tick(core);
    maxX = Math.max(maxX, b1.physics_model.getPosition().x);
  }
  check('ghost driven into the wall at 8 m/s stays inside the map', maxX < wallX, `max x ${maxX.toFixed(2)} < wall ${wallX}`);
}

// Off again, and a new race clears ghosts.
{
  setFinishGhost(b1, false);
  check('setFinishGhost(off) restores the default filter', !b1.finishGhost && b1.physics_model.getFixtureList().getFilterCategoryBits() === 1 && b1.physics_model.getFixtureList().shouldCollide(b0.physics_model.getFixtureList()));
  const q = b1.physics_model.getPosition();
  b0.physics_model.setPosition({ x: q.x + 0.5, y: q.y });
  tick(core);
  check('control: the same overlap without the ghost is a rule pair', sim.last.resolutions.some((r) => r.boatA === b1 || r.boatB === b1));
  setFinishGhost(b1, true);
  mute(() => core.command({ type: 'restart', scenario: 16 }));
  tick(core);
  check('new race: no ghosts', sim.players.length === 2 && sim.players.every((b) => !b.finishGhost));
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all finish ghost checks passed');
