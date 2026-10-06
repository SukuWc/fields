// Headless checks for the rule registry: every pair inside 12 m, separate
// per-pair state, and the resolver's inhibition / fault fields.
// Run: node scripts/rule-pairs-check.mjs

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const planck = require("planck-js");
const { ConstantWind } = await import("../src/wind.js");
const {
  evaluateAllPairs,
  evaluateSectionA,
  pairRuleState,
  pairStateCount,
  resetRule15Memory,
  ruleRegistry,
  headingForward,
  SIM_STEP_S,
} = await import("../src/rules.js");

const Vec2 = planck.Vec2;
const World = planck.World;

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL", message);
    process.exitCode = 1;
    throw new Error(message);
  }
}

const wind = new ConstantWind(90, 15);
const getWind = (x, y) => wind.getWind(x, y);

const HULL = [
  Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25), Vec2(-0.75, 0.5),
  Vec2(-0.5, 1.75), Vec2(0.5, 1.75), Vec2(0.75, 0.5), Vec2(0.75, -0.25),
  Vec2(0.5, -1.25), Vec2(0, -2.25),
];

const world = new World(Vec2(0, 0));
const STARBOARD = 5 * Math.PI / 4;
const PORT = 3 * Math.PI / 4;

function makeBoat(x, y, hullAngle) {
  const hull = planck.Polygon(HULL);
  const body = world.createBody({
    type: "dynamic",
    position: Vec2(x, y),
    angle: hullAngle,
  });
  body.createFixture(hull, 6);
  return {
    x,
    y,
    hull_angle: hullAngle,
    hull_shape: hull,
    physics_model: body,
    tacking: false,
  };
}

function place(boat, x, y, hullAngle) {
  boat.physics_model.setTransform(Vec2(x, y), hullAngle);
  boat.x = x;
  boat.y = y;
  boat.hull_angle = hullAngle;
}

function pairOf(resolutions, boatA, boatB) {
  for (let i = 0; i < resolutions.length; i++) {
    const r = resolutions[i];
    if ((r.boatA === boatA && r.boatB === boatB) || (r.boatA === boatB && r.boatB === boatA)) return r;
  }
  return null;
}

assert(ruleRegistry.some((entry) => entry.id === "13" && entry.inhibits.indexOf("10") >= 0), "Rule 13 declares that it inhibits Rule 10");
assert(ruleRegistry.some((entry) => entry.id === "15" && entry.layer === "timedInhibitor"), "Rule 15 is a timed inhibitor");

// --- three boats, three pairs, state does not leak across pairs ---

resetRule15Memory();
const fwd = headingForward(STARBOARD);
const leader = makeBoat(0, 0, STARBOARD);
const trailer = makeBoat(-fwd.x * 4.05, -fwd.y * 4.05, STARBOARD);
// Port boat on the leader's beam, inside 12 m of both, stable opposite tacks.
const port = makeBoat(0, 6, PORT);

let t = 0;
let resolutions = evaluateAllPairs([leader, trailer, port], getWind, t);
assert(resolutions.length === 3, "three boats inside 12 m make three pairs, got " + resolutions.length);
assert(pairStateCount() === 3, "each in-range pair keeps its own state, count " + pairStateCount());

const overlap = pairOf(resolutions, leader, trailer);
const opposite = pairOf(resolutions, leader, port);
const other = pairOf(resolutions, trailer, port);
assert(overlap && opposite && other, "each boat pair is present");
assert(overlap.pairKey !== opposite.pairKey && overlap.pairKey !== other.pairKey, "pair keys differ");
assert(overlap.final && overlap.final.rule === "Rule 12", "leader/trailer opens on Rule 12");
assert(opposite.final && opposite.final.rule === "Rule 10", "leader/port opens on Rule 10");
assert(opposite.faultBoat === port, "Rule 10 fault is the port keep-clear boat");
assert(!opposite.final.inhibited, "the final rule is not inhibited");
const abState = pairRuleState(leader, trailer, "15");
const acState = pairRuleState(leader, port, "15");
assert(abState && !abState.active, "Rule 12 pair has no Rule 15 timer yet");
assert(acState && !acState.active, "Rule 10 pair has no Rule 15 timer");

// Same boats, reversed call order, same simulation time: a redraw. Keys and
// decisions stay put, and the timer does not start early.
const redraw = evaluateAllPairs([port, trailer, leader], getWind, t);
assert(redraw.length === 3, "redraw still returns three pairs");
const redrawKeys = redraw.map((r) => r.pairKey).sort().join(",");
const firstKeys = resolutions.map((r) => r.pairKey).sort().join(",");
assert(redrawKeys === firstKeys, "pair keys do not depend on boat order, " + redrawKeys + " vs " + firstKeys);
assert(pairOf(redraw, leader, port).final.rule === "Rule 10", "redraw keeps Rule 10");
assert(!pairRuleState(leader, trailer, "15").active, "a same-time redraw does not start Rule 15");

t += SIM_STEP_S;
place(trailer, -fwd.x * 3.9, -fwd.y * 3.9, STARBOARD);
resolutions = evaluateAllPairs([leader, trailer, port], getWind, t);
const gained = pairOf(resolutions, leader, trailer);
const stillTen = pairOf(resolutions, leader, port);
assert(gained.final && gained.final.id === "15", "trailer overlap is Rule 15 on that pair only, got " + (gained.final && gained.final.rule));
assert(gained.final.blockedRule === "Rule 11", "Rule 15 blocks Rule 11");
assert(gained.faultBoat === trailer, "during Rule 15 the new right-of-way boat is at fault");
const blocked = gained.applicable.filter((r) => r.id === "11")[0];
assert(blocked && blocked.inhibited && blocked.inhibitedBy === "15", "Rule 11 is inhibited by Rule 15");
assert(gained.guides.some((g) => g.type === "label" && g.text === "Rule 15 (blocks Rule 11)"), "overlay label is unchanged");
assert(stillTen.final && stillTen.final.rule === "Rule 10" && stillTen.final.id !== "15", "the other pair stays on Rule 10");
assert(!pairRuleState(leader, port, "15").active, "Rule 15 state did not leak onto the Rule 10 pair");
assert(pairRuleState(leader, trailer, "15").active, "Rule 15 state stays on the overlap pair");
assert(pairRuleState(leader, trailer, "15") !== pairRuleState(leader, port, "15"), "the two pairs do not share a state object");

// The third boat leaving the gate drops only her pairs.
place(port, 40, 40, PORT);
assert(evaluateSectionA(leader, port, getWind) === null, "moved port boat is outside 12 m");
t += SIM_STEP_S;
resolutions = evaluateAllPairs([leader, trailer, port], getWind, t);
assert(resolutions.length === 1, "only the in-range pair is evaluated, got " + resolutions.length);
assert(resolutions[0].boatA === leader || resolutions[0].boatB === leader, "the remaining pair is the overlap");
assert(pairStateCount() === 1, "out-of-range pair state is removed, count " + pairStateCount());
assert(pairRuleState(leader, port, "15") === null, "leader/port state is gone");
assert(pairRuleState(leader, trailer, "15").active, "the overlap timer survives the other boat leaving");

// Removing the trailer drops her pair too. An empty fleet holds nothing.
resolutions = evaluateAllPairs([leader, port], getWind, t + SIM_STEP_S);
assert(resolutions.length === 0, "the two boats left are outside 12 m of each other");
assert(pairStateCount() === 0, "removing a boat drops pair state that named her, count " + pairStateCount());
resolutions = evaluateAllPairs([], getWind, t + 2 * SIM_STEP_S);
assert(pairStateCount() === 0, "an empty fleet does not leak pair state");

// --- Rule 13 inhibits Rule 10, and the single label stays "Rule 13" ---

resetRule15Memory();
const tacker = makeBoat(0, 0, STARBOARD);
const standOn = makeBoat(0, 5, PORT);
tacker.tacking = true;
t = 0;
resolutions = evaluateAllPairs([tacker, standOn], getWind, t);
assert(resolutions.length === 1, "tacking pair is in range");
const tacked = resolutions[0];
assert(tacked.final && tacked.final.rule === "Rule 13", "final rule is Rule 13, got " + (tacked.final && tacked.final.rule));
const inhibitedTen = tacked.applicable.filter((r) => r.id === "10")[0];
assert(inhibitedTen && inhibitedTen.inhibited && inhibitedTen.inhibitedBy === "13", "Rule 10 still holds and is inhibited by Rule 13");
assert(tacked.inhibited.length === 1 && tacked.inhibited[0].id === "10", "the inhibited list names Rule 10");
assert(tacked.faultBoat === tacker, "the tacking boat is at fault");
assert(tacked.rightOfWay === standOn && tacked.keepClear === tacker, "stand-on boat keeps right of way");
const labels = tacked.guides.filter((g) => g.type === "label");
assert(labels.length === 1 && labels[0].text === "Rule 13", "the overlay still shows a single Rule 13 label");
assert(!tacked.guides.some((g) => g.rule15), "Rule 13 does not draw a Rule 15 bar");

// Both tacking: no single fault boat. The label stays "Rule 13 both".
standOn.tacking = true;
t += SIM_STEP_S;
resolutions = evaluateAllPairs([tacker, standOn], getWind, t);
assert(resolutions[0].final && resolutions[0].final.rule === "Rule 13 both", "both tacking is Rule 13 both");
assert(resolutions[0].faultBoat === null, "both keep-clear is not a single fault");
assert(resolutions[0].guides.filter((g) => g.type === "label")[0].text === "Rule 13 both", "label is Rule 13 both");

console.log("rule pair checks passed");
