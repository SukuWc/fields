// Headless checks for the anchored mark (src/mark.js) and scenario 11.
// The mark is a dynamic 1 m circle with a tenth of the boat's mass, pulled
// back to its anchor by F = -k·d - c·v. A starboard close-hauled boat on
// autopilot sails into it: contact happens, the buoy is shoved off station,
// and it drifts back. The rules engine runs on the players only and must
// not trip over a mark in the world.
// Run: node --import ./test/register.mjs scripts/mark-check.mjs

const info = { innerHTML: "" };
// planck-with-testbed's UMD wrapper names `window` even under Node; the boat
// step only writes to #info.
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { href: "http://localhost/" };
globalThis.document = {
  getElementById() {
    return info;
  },
  getElementsByTagName() {
    return [];
  },
  currentScript: { src: "http://localhost/mark-check.mjs" },
  createElement() {
    return { getContext() { return null; } };
  },
};

const { Map } = await import("../src/map.js");
const { Boat } = await import("../src/boat.js");
const {
  Mark,
  markMassForBoat,
  markRestoringForce,
  MARK_RADIUS,
  MARK_MASS_RATIO,
  MARK_SPRING_K,
  MARK_DAMPING,
} = await import("../src/mark.js");
const { evaluateAllPairs, recordContacts, resetContacts, resetRule15Memory, getIncidents } = await import("../src/rules.js");

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok  ", message);
}

const DT = 1 / 30;

// --- Restoring force: toward the anchor, growing with distance ---

{
  const ax = 3, ay = -2;
  let last = 0;
  for (const d of [0.5, 1, 2, 4]) {
    for (const ang of [0, 1, 2.5, 4]) {
      const x = ax + Math.cos(ang) * d;
      const y = ay + Math.sin(ang) * d;
      const f = markRestoringForce(x, y, ax, ay);
      const mag = Math.hypot(f.x, f.y);
      const dot = (f.x * (ax - x) + f.y * (ay - y)) / (mag * d);
      assert(dot > 0.9999, `force at ${d} m, angle ${ang} points at the anchor`);
      assert(Math.abs(mag - MARK_SPRING_K * d) < 1e-9, `force at rest is k·d (${mag.toFixed(3)} at ${d} m)`);
    }
    const mag = MARK_SPRING_K * d;
    assert(mag > last, `force grows with distance (${d} m)`);
    last = mag;
  }
  const atAnchor = markRestoringForce(ax, ay, ax, ay);
  assert(atAnchor.x === 0 && atAnchor.y === 0, "no force on station at rest");
  const damped = markRestoringForce(ax, ay, ax, ay, 1, -2);
  assert(Math.abs(damped.x + MARK_DAMPING) < 1e-9 && Math.abs(damped.y - 2 * MARK_DAMPING) < 1e-9, "damping opposes velocity");
}

// --- Scenario 11 geometry (src/controls.js) ---

const map = new Map(75, 75, 90, 15, null);
map.physics_model_init();
map.setDevMode(true);

const heading = 5 * Math.PI / 4 + 5 * Math.PI / 180;
const fx = Math.sin(heading);
const fy = -Math.cos(heading);
const boat = new Boat(map, 12, -10, heading);
boat.physics_model.setLinearVelocity({ x: fx * 1.9, y: fy * 1.9 });
const ahead = 9;
const boatMass = boat.physics_model.getMass();
const mark = new Mark(map, 12 + fx * ahead, -10 + fy * ahead, { mass: markMassForBoat(boat.physics_model) });
boat.input_autopilot_enabled_toggle();

const markBody = mark.physics_model;
assert(Math.abs(markBody.getMass() - boatMass * MARK_MASS_RATIO) < 1e-6, `mark mass ${markBody.getMass().toFixed(4)} ≈ boat mass ${boatMass.toFixed(3)} / 10`);
assert(Math.abs(MARK_MASS_RATIO - 0.1) < 1e-12, "mass ratio is one tenth");
const fixture = markBody.getFixtureList();
assert(fixture.getType() === "circle" && Math.abs(fixture.getShape().m_radius - 0.5) < 1e-12 && MARK_RADIUS === 0.5, "circle fixture, radius 0.5 m (1 m diameter)");
assert(markBody.isDynamic(), "mark is a dynamic body");
assert(mark.anchor.x === markBody.getPosition().x && mark.anchor.y === markBody.getPosition().y, "anchor defaults to the starting position");

let threw = false;
try { new Mark(map, 0, 0, {}); } catch (e) { threw = true; }
assert(threw, "a mark without a mass is refused (mass is never hardcoded)");

function touching() {
  for (let c = map.world.getContactList(); c; c = c.getNext()) {
    if (!c.isTouching()) continue;
    const a = c.getFixtureA().getBody();
    const b = c.getFixtureB().getBody();
    if ((a === markBody && b === boat.physics_model) || (b === markBody && a === boat.physics_model)) return true;
  }
  return false;
}

resetRule15Memory();
resetContacts();
let firstContact = null;
let maxD = 0;
let maxAt = 0;
let simTime = 0;
let sampledPull = false;
const pulls = [];
for (let i = 0; i < 20 * 30; i++) {
  boat.physics_model_step();
  mark.physics_model_step();
  map.world.step(DT);
  simTime += DT;
  // Rules engine sees boats only; one boat and a mark must not throw.
  const res = evaluateAllPairs([boat], (x, y) => map.get_wind(x, y), simTime);
  recordContacts(res, simTime, [boat]);
  if (firstContact === null && touching()) firstContact = simTime;
  const d = mark.displacement();
  if (d > maxD) { maxD = d; maxAt = simTime; }
  // While displaced, the force applied this step points back at the anchor.
  if (d > 0.5) {
    // mark.force was computed from the pre-step state; subtract the damper
    // (it used that step's velocity, stored on the mark) to get the spring.
    const v = mark.lastVelocity;
    const sx = mark.force.x + MARK_DAMPING * v.x;
    const sy = mark.force.y + MARK_DAMPING * v.y;
    const pd = Math.hypot(mark.lastPosition.x - mark.anchor.x, mark.lastPosition.y - mark.anchor.y);
    const toward = (sx * (mark.anchor.x - mark.lastPosition.x) + sy * (mark.anchor.y - mark.lastPosition.y)) / pd;
    pulls.push({ d: pd, spring: MARK_SPRING_K * pd, toward, mag: Math.hypot(sx, sy) });
    sampledPull = true;
  }
}

assert(firstContact !== null && firstContact < 6, `boat hits the mark (first contact at ${firstContact && firstContact.toFixed(2)} s)`);
assert(maxD > 1.5, `the hit shoves the mark off station (max ${maxD.toFixed(2)} m at ${maxAt.toFixed(2)} s)`);
assert(sampledPull, "force sampled while displaced");
assert(pulls.every((p) => Math.abs(p.toward - p.spring) < 1e-9 && Math.abs(p.mag - p.spring) < 1e-9), `applied spring part points straight at the anchor with magnitude k·d (${pulls.length} displaced steps)`);
const springPart = pulls.slice().sort((a, b) => a.d - b.d);
assert(springPart[springPart.length - 1].spring > springPart[0].spring, "spring pull is larger farther from the anchor");
const endD = mark.displacement();
assert(endD < 0.2, `mark is back near its anchor after 20 s (${endD.toFixed(3)} m)`);
assert(getIncidents().length === 0, "no boat-boat incident for a boat touching a mark (rule 31 lives in mark-touch.js, see mark-touch-check)");
assert(Number.isFinite(boat.x) && Number.isFinite(boat.y), "boat stays finite");

console.log(`mark mass ${markBody.getMass().toFixed(4)} (boat ${boatMass.toFixed(3)}), k ${MARK_SPRING_K}, c ${MARK_DAMPING}, first contact ${firstContact.toFixed(2)} s, max displacement ${maxD.toFixed(2)} m at ${maxAt.toFixed(2)} s, end ${endD.toFixed(3)} m`);
if (!process.exitCode) console.log("mark-check: all passed");
