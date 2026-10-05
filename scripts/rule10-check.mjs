// Headless checks for Rule 10 tack, the 12 m hull gate, and the overlay split.
// Run: node scripts/rule10-check.mjs
//
// Uses planck-js's library entry (not the testbed bundle, which needs a DOM)
// and the same hull polygon Boat builds in src/boat.js.

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const planck = require("planck-js");
const { ConstantWind } = await import("../src/wind.js");
const {
  classifyTack,
  boatClearance,
  evaluateSectionA,
  sectionAOverlay,
  hullVerticesWorld,
  RULE10_INTEREST_RANGE_M,
  polygonClearance,
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
assert(Math.abs(wind.getWind(0, 0).direction - 90) < 1e-6, "constant wind from +Y is 90°");

// Scenario 2 headings, wind from +Y. Port is 3π/4, starboard is 5π/4.
assert(classifyTack(3 * Math.PI / 4, 90) === "port", "3π/4 on wind-from-90 is port");
assert(classifyTack(5 * Math.PI / 4, 90) === "starboard", "5π/4 on wind-from-90 is starboard");
assert(classifyTack(Math.PI, 90) === null, "head to wind is not a tack");
assert(classifyTack(0, 90) === null, "dead downwind is not a tack");
// Unwrapped heading (Planck can accumulate) stays on the same tack.
assert(classifyTack(3 * Math.PI / 4 + 2 * Math.PI, 90) === "port", "wrapped port heading");

function square(x, y, size) {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

assert(Math.abs(polygonClearance(square(0, 0, 1), square(13, 0, 1)) - 12) < 1e-9, "axis gap of 12");
assert(polygonClearance(square(0, 0, 2), square(1, 1, 2)) === 0, "overlap is 0");

// Same loop Boat passes to pl.Polygon. Bow is local −Y.
const HULL = [
  Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25), Vec2(-0.75, 0.5),
  Vec2(-0.5, 1.75), Vec2(0.5, 1.75), Vec2(0.75, 0.5), Vec2(0.75, -0.25),
  Vec2(0.5, -1.25), Vec2(0, -2.25),
];

function makeBoat(world, x, y, hullAngle) {
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
  };
}

const world = new World(Vec2(0, 0));
const port = makeBoat(world, -10, -6, 3 * Math.PI / 4);
const starboard = makeBoat(world, 15, -11.5, 5 * Math.PI / 4);

const portHull = hullVerticesWorld(port);
assert(portHull.length >= 3, "hull polygon has vertices, got " + portHull.length);
// Bow is local (0, -2.25). Forward (sin θ, −cos θ) at θ = 3π/4 is (+x, +y).
const bow = port.physics_model.getWorldPoint(Vec2(0, -2.25));
assert(bow.x > port.x && bow.y > port.y, "port bow is ahead of the body origin");

const getWind = (x, y) => wind.getWind(x, y);
const far = boatClearance(port, starboard);
assert(far > RULE10_INTEREST_RANGE_M, "scenario 2 start is outside 12 m, clearance " + far);
assert(evaluateSectionA(port, starboard, getWind) === null, "no Rule 10 outside range");
assert(sectionAOverlay(port, starboard, getWind).length === 0, "no overlay outside range");

// Slide the starboard boat onto the port boat's beam, still on starboard tack.
starboard.physics_model.setTransform(Vec2(-4, -6), 5 * Math.PI / 4);
starboard.x = -4;
starboard.y = -6;
starboard.hull_angle = 5 * Math.PI / 4;

const near = boatClearance(port, starboard);
assert(near <= RULE10_INTEREST_RANGE_M, "closing pair is inside 12 m, clearance " + near);
assert(near < Math.hypot(port.x - starboard.x, port.y - starboard.y), "hull clearance is inside center distance");

const obligation = evaluateSectionA(port, starboard, getWind);
assert(obligation && obligation.rule === "Rule 10", "opposite tacks in range select Rule 10");
assert(obligation.rightOfWay === starboard, "starboard is right of way");
assert(obligation.giveWay === port, "port keeps clear");

const overlay = sectionAOverlay(port, starboard, getWind);
assert(overlay.length === 3, "two halves plus a label");
const green = overlay[0];
const red = overlay[1];
const label = overlay[2];
assert(green.color === 0x00ff00 && green.x2 === starboard.x && green.y2 === starboard.y, "green half ends on starboard");
assert(red.color === 0xff0000 && red.x2 === port.x && red.y2 === port.y, "red half ends on port");
assert(label.type === "label" && label.text === "Rule 10", "midpoint label is Rule 10");
const midX = (port.x + starboard.x) / 2;
const midY = (port.y + starboard.y) / 2;
assert(Math.abs(label.x - midX) < 1e-9 && Math.abs(label.y - midY) < 1e-9, "label sits on the midpoint");
assert(Math.abs(green.x1 - midX) < 1e-9 && Math.abs(red.x1 - midX) < 1e-9, "halves meet at the midpoint");

// Same tack, still in range: Rules 11 and 12 are stubs, so no line.
starboard.hull_angle = 3 * Math.PI / 4;
assert(evaluateSectionA(port, starboard, getWind) === null, "same tack does not draw");
assert(sectionAOverlay(port, starboard, getWind).length === 0, "same tack overlay is empty");

// Opposite tacks but just outside the gate.
starboard.physics_model.setTransform(Vec2(20, -6), 5 * Math.PI / 4);
starboard.x = 20;
starboard.y = -6;
starboard.hull_angle = 5 * Math.PI / 4;
assert(boatClearance(port, starboard) > RULE10_INTEREST_RANGE_M, "separated hulls exceed 12 m");
assert(sectionAOverlay(port, starboard, getWind).length === 0, "gate hides the line");

console.log("rule10 checks passed");
console.log("scenario start hull clearance", far.toFixed(2), "m; close pair", near.toFixed(2), "m");
