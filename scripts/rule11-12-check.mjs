// Headless checks for Rule 11 (same tack, overlapped) and Rule 12 (same tack,
// clear astern). Run: node scripts/rule11-12-check.mjs
//
// Hulls match Boat in src/boat.js. Wind is ConstantWind, the dev-mode provider
// behind Map.get_wind.

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const planck = require("planck-js");
const { ConstantWind } = await import("../src/wind.js");
const {
  classifyTack,
  boatClearance,
  evaluateSectionA,
  sectionAOverlay,
  sameTackGeometry,
  isClearAstern,
  headingForward,
  hullVerticesWorld,
  RULE10_INTEREST_RANGE_M,
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

const windFromNorth = new ConstantWind(90, 15);
const getWind = (x, y) => windFromNorth.getWind(x, y);

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

function place(boat, x, y, hullAngle) {
  boat.physics_model.setTransform(Vec2(x, y), hullAngle);
  boat.x = x;
  boat.y = y;
  boat.hull_angle = hullAngle;
}

function assertOverlay(obligation, aheadOrLeeward, giveWay, ruleName) {
  assert(obligation && obligation.rule === ruleName, "expected " + ruleName + ", got " + (obligation && obligation.rule));
  assert(obligation.rightOfWay === aheadOrLeeward, ruleName + " right of way");
  assert(obligation.giveWay === giveWay, ruleName + " give way");
  const overlay = sectionAOverlay(obligation.rightOfWay, obligation.giveWay, getWind);
  const green = overlay[0];
  const red = overlay[1];
  const label = overlay[2];
  assert(green.color === 0x00ff00 && green.x2 === aheadOrLeeward.x && green.y2 === aheadOrLeeward.y, ruleName + " green ends on right of way");
  assert(red.color === 0xff0000 && red.x2 === giveWay.x && red.y2 === giveWay.y, ruleName + " red ends on give way");
  assert(label.type === "label" && label.text === ruleName, ruleName + " label");
  const midX = (aheadOrLeeward.x + giveWay.x) / 2;
  const midY = (aheadOrLeeward.y + giveWay.y) / 2;
  assert(Math.abs(label.x - midX) < 1e-9 && Math.abs(label.y - midY) < 1e-9, ruleName + " label is the midpoint");
  assert(Math.abs(green.x1 - midX) < 1e-9 && Math.abs(green.y1 - midY) < 1e-9, ruleName + " green half starts at the midpoint");
  assert(Math.abs(red.x1 - midX) < 1e-9 && Math.abs(red.y1 - midY) < 1e-9, ruleName + " red half starts at the midpoint");

  const marks = overlay.filter((r) => r.type === "abeam");
  assert(overlay.length === 3 + marks.length, ruleName + " overlay is the ribbon, the label, and stern marks");
  if (ruleName === "Rule 12") {
    assert(marks.length === 1, "Rule 12 draws the clear-ahead stern only");
    assertSternMark(marks[0], aheadOrLeeward);
  } else if (ruleName === "Rule 11") {
    assert(marks.length === 2, "Rule 11 draws both sterns");
    assertSternMark(marks[0], aheadOrLeeward);
    assertSternMark(marks[1], giveWay);
  }
}

function assertSternMark(seg, boat) {
  assert(seg && seg.type === "abeam" && seg.color === 0x66eeff, "stern mark is a cyan abeam segment");
  const fwd = headingForward(boat.hull_angle);
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  assert(Math.abs(Math.hypot(dx, dy) - 4) < 1e-6, "stern mark is 4 m");
  assert(Math.abs(dx * fwd.x + dy * fwd.y) < 1e-6, "stern mark is perpendicular to course");
  const mid = ((seg.x1 + seg.x2) / 2) * fwd.x + ((seg.y1 + seg.y2) / 2) * fwd.y;
  const poly = hullVerticesWorld(boat);
  let aftermost = Infinity;
  for (const p of poly) aftermost = Math.min(aftermost, p.x * fwd.x + p.y * fwd.y);
  assert(Math.abs(mid - aftermost) < 1e-3, "stern mark lies on the aftermost station");
}

// --- polygon definition, independent of tack ---

const courseNorth = { x: 0, y: 1 };
const aheadBox = [
  { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 },
];
const fullyBehind = [
  { x: 0, y: -3 }, { x: 2, y: -3 }, { x: 2, y: -1 }, { x: 0, y: -1 },
];
const bowAcross = [
  { x: 0, y: -3 }, { x: 2, y: -3 }, { x: 2, y: 0.2 }, { x: 0, y: -1 },
];
const onTheLine = [
  { x: 0, y: -3 }, { x: 2, y: -3 }, { x: 2, y: 0 }, { x: 0, y: -1 },
];
assert(isClearAstern(fullyBehind, aheadBox, courseNorth), "hull entirely behind the abeam line is clear astern");
assert(!isClearAstern(bowAcross, aheadBox, courseNorth), "one vertex across the abeam line is not clear astern");
assert(!isClearAstern(onTheLine, aheadBox, courseNorth), "a vertex on the abeam line is not behind it");

// --- scenario 1: both starboard, clear ahead / astern, already inside 12 m ---

const world = new World(Vec2(0, 0));
const STARBOARD = 5 * Math.PI / 4;
const PORT = 3 * Math.PI / 4;
const aheadS1 = makeBoat(world, 12, -6, STARBOARD);
const asternS1 = makeBoat(world, 15, -11.5, STARBOARD);

assert(classifyTack(STARBOARD, 90) === "starboard", "scenario 1 heading is starboard");
assert(classifyTack(aheadS1.hull_angle, 90) === classifyTack(asternS1.hull_angle, 90), "scenario 1 boats share a tack");

const s1Clearance = boatClearance(aheadS1, asternS1);
assert(s1Clearance <= RULE10_INTEREST_RANGE_M, "scenario 1 spawn is inside 12 m, clearance " + s1Clearance);
const s1Geo = sameTackGeometry(aheadS1, asternS1);
assert(s1Geo && !s1Geo.overlapped && s1Geo.clearAhead === aheadS1 && s1Geo.clearAstern === asternS1, "scenario 1 is clear ahead/astern");
assertOverlay(evaluateSectionA(aheadS1, asternS1, getWind), aheadS1, asternS1, "Rule 12");
assertOverlay(evaluateSectionA(asternS1, aheadS1, getWind), aheadS1, asternS1, "Rule 12");

// The astern boat is also the leeward one (smaller Y, wind from +Y). Rule 12
// still gives right of way to the boat clear ahead.
assert(asternS1.y < aheadS1.y, "scenario 1 astern boat is downwind of the leader");

// Slide her farther astern, same heading, until the hulls leave the gate.
const away = headingForward(STARBOARD);
place(asternS1, 12 - away.x * 30, -6 - away.y * 30, STARBOARD);
assert(boatClearance(aheadS1, asternS1) > RULE10_INTEREST_RANGE_M, "separated scenario-1 pair is outside 12 m");
assert(evaluateSectionA(aheadS1, asternS1, getWind) === null, "Rule 12 hides outside 12 m");
assert(sectionAOverlay(aheadS1, asternS1, getWind).length === 0, "no Rule 12 overlay outside 12 m");

// --- along-track boundary: bow on the stern line flips 12 → 11 ---

const leader = makeBoat(world, 0, 0, STARBOARD);
const trailer = makeBoat(world, 0, 0, STARBOARD);
const fwd = headingForward(STARBOARD);

// Center gap of 4 m puts the trailer's bow (local y -2.25) on the leader's
// aftermost line (local y 1.75). On the line is not "behind", so they overlap.
place(trailer, -fwd.x * 4, -fwd.y * 4, STARBOARD);
assert(sameTackGeometry(leader, trailer).overlapped, "bow on the abeam line is overlapped");
const onLine = evaluateSectionA(leader, trailer, getWind);
assert(onLine && onLine.rule === "Rule 11", "contact with the abeam line is Rule 11");
// Trailer is downwind (lower Y). She is leeward, so she takes right of way
// the moment the overlap exists — the opposite of Rule 12.
assert(onLine.rightOfWay === trailer && onLine.giveWay === leader, "leeward trailer gains right of way on overlap");

place(trailer, -fwd.x * 4.05, -fwd.y * 4.05, STARBOARD);
assert(sameTackGeometry(leader, trailer).clearAstern === trailer, "5 cm of clear water astern is clear astern");
assertOverlay(evaluateSectionA(leader, trailer, getWind), leader, trailer, "Rule 12");

place(trailer, -fwd.x * 3.95, -fwd.y * 3.95, STARBOARD);
assert(sameTackGeometry(leader, trailer).overlapped, "bow 5 cm past the line is overlapped");
assertOverlay(evaluateSectionA(trailer, leader, getWind), trailer, leader, "Rule 11");

// --- overlapped side by side, starboard. Higher Y is windward (wind from +Y). ---

const leeward = makeBoat(world, 0, -8, STARBOARD);
const windward = makeBoat(world, 0, -5, STARBOARD);
assert(boatClearance(leeward, windward) <= RULE10_INTEREST_RANGE_M, "side-by-side pair is inside 12 m");
assert(sameTackGeometry(leeward, windward).overlapped, "side-by-side starboard boats are overlapped");
assertOverlay(evaluateSectionA(leeward, windward, getWind), leeward, windward, "Rule 11");
assertOverlay(evaluateSectionA(windward, leeward, getWind), leeward, windward, "Rule 11");

// Same geometry on port tack: windward is still the boat toward the wind source.
place(leeward, 0, -8, PORT);
place(windward, 0, -5, PORT);
assert(classifyTack(PORT, 90) === "port", "3π/4 is port");
assert(sameTackGeometry(leeward, windward).overlapped, "side-by-side port boats are overlapped");
assertOverlay(evaluateSectionA(leeward, windward, getWind), leeward, windward, "Rule 11");

// Port tack, clear astern. Right of way is clear ahead, even though she is
// the windward boat and the trailer is leeward.
const portAhead = makeBoat(world, 0, 0, PORT);
const portFwd = headingForward(PORT);
const portAstern = makeBoat(world, -portFwd.x * 6, -portFwd.y * 6, PORT);
assert(classifyTack(portAhead.hull_angle, 90) === "port", "port-tack Rule 12 pair");
assert(portAstern.y < portAhead.y, "port-tack trailer is downwind");
assertOverlay(evaluateSectionA(portAhead, portAstern, getWind), portAhead, portAstern, "Rule 12");

// Wind from +X, so windward is larger X, not larger Y.
const windFromEast = new ConstantWind(0, 15);
const getEast = (x, y) => windFromEast.getWind(x, y);
const eastLow = makeBoat(world, 0, 0, Math.PI);
const eastHigh = makeBoat(world, 3, 0, Math.PI);
assert(classifyTack(Math.PI, 0) === "starboard", "heading π in wind-from-0 is starboard");
assert(sameTackGeometry(eastLow, eastHigh).overlapped, "beam pair in an easterly is overlapped");
const eastRule = evaluateSectionA(eastHigh, eastLow, getEast);
assert(eastRule && eastRule.rule === "Rule 11", "easterly overlap is Rule 11");
assert(eastRule.giveWay === eastHigh && eastRule.rightOfWay === eastLow, "farther toward +X is windward");
const eastOverlay = sectionAOverlay(eastLow, eastHigh, getEast);
assert(eastOverlay[2].text === "Rule 11" && eastOverlay[0].x2 === eastLow.x && eastOverlay[1].x2 === eastHigh.x, "easterly overlay colors follow leeward/windward");

// Equal upwind projection: overlapped, but neither boat is windward.
const tieA = makeBoat(world, 0, 0, 3 * Math.PI / 2);
const tieB = makeBoat(world, -3, 0, 3 * Math.PI / 2);
assert(classifyTack(3 * Math.PI / 2, 90) === "starboard", "heading 3π/2 is starboard in wind-from-90");
assert(sameTackGeometry(tieA, tieB).overlapped, "in-line overlap with equal upwind score");
assert(evaluateSectionA(tieA, tieB, getWind) === null, "Rule 11 draws nothing when neither boat is windward");

// Different courses, same tack. Clear astern uses the ahead boat's course.
const courseA = makeBoat(world, 0, 0, STARBOARD);
const courseB = makeBoat(world, -fwd.x * 6, -fwd.y * 6, 3 * Math.PI / 2);
assert(classifyTack(courseB.hull_angle, 90) === "starboard", "different-course pair is still starboard");
const courseGeo = sameTackGeometry(courseA, courseB);
assert(courseGeo && !courseGeo.overlapped && courseGeo.clearAhead === courseA && courseGeo.clearAstern === courseB, "astern test follows the leader's course");
assertOverlay(evaluateSectionA(courseB, courseA, getWind), courseA, courseB, "Rule 12");

// Each boat clear astern of the other: no Rule 12, and not Rule 11.
const apartA = makeBoat(world, 0, 0, STARBOARD);
const apartB = makeBoat(world, 2, -6, 7 * Math.PI / 4);
assert(classifyTack(apartB.hull_angle, 90) === "starboard", "mutual pair is starboard");
assert(boatClearance(apartA, apartB) <= RULE10_INTEREST_RANGE_M, "mutual clear-astern pair is inside the gate");
const apartGeo = sameTackGeometry(apartA, apartB);
assert(apartGeo && apartGeo.mutualClearAstern && !apartGeo.overlapped, "each boat is clear astern of the other");
assert(evaluateSectionA(apartA, apartB, getWind) === null, "mutual clear astern draws nothing");

// Opposite tacks still win, including when the boats are side by side.
place(leeward, 0, -8, PORT);
place(windward, 0, -5, STARBOARD);
const opposite = evaluateSectionA(leeward, windward, getWind);
assert(opposite && opposite.rule === "Rule 10", "opposite tacks stay on Rule 10");
assert(opposite.rightOfWay === windward && opposite.giveWay === leeward, "starboard keeps right of way over a leeward port boat");
assert(!sectionAOverlay(leeward, windward, getWind).some((r) => r.type === "abeam"), "Rule 10 draws no stern mark");

// Head to wind is not a tack, so neither 11 nor 12 applies.
place(leeward, 0, -8, Math.PI);
place(windward, 0, -5, STARBOARD);
assert(classifyTack(Math.PI, 90) === null, "head to wind is not a tack");
assert(evaluateSectionA(leeward, windward, getWind) === null, "head to wind draws nothing");

// No hull polygon: the gate can pass on centers, but overlap is undefined.
const bareA = { x: 0, y: 0, hull_angle: STARBOARD };
const bareB = { x: 3, y: 0, hull_angle: STARBOARD };
assert(boatClearance(bareA, bareB) <= RULE10_INTEREST_RANGE_M, "center fallback is inside 12 m");
assert(sameTackGeometry(bareA, bareB) === null, "overlap needs both hulls");
assert(evaluateSectionA(bareA, bareB, getWind) === null, "same tack without hulls draws nothing");

console.log("rule 11/12 checks passed");
console.log("scenario 1 hull clearance", s1Clearance.toFixed(2), "m");
