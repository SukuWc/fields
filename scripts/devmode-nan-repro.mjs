// Headless check for the dev-mode toggle NaN.
//
// What used to break, in order:
//   1. A sail held on one patch of water drives lattice |u| up until density
//      collapses. Eq. 5 then divides by ~0 and the cell's ux/uy become NaN.
//   2. The boat samples that NaN, the wind smoother latches it, and the sail
//      force goes NaN. Planck integrates a NaN body, and Three.js reports
//      computeBoundingSphere radius NaN.
//   3. The next sample indexes the lattice with a NaN coordinate
//      (cells[NaN].ux throws), or a boat past the wall builds a level-2
//      domain with a negative size (Invalid array length).
//   4. Separately, awa = ±180 reads one past the end of the 21-entry aero
//      table. undefined * 0 is NaN, which is the same sail-force failure.
//
// Run: node scripts/devmode-nan-repro.mjs

globalThis.document = {
  getElementById() {
    return { value: "0", selectedIndex: 0, checked: true };
  },
};
globalThis.window = {};

const { Boltzmann } = await import("../src/boltzmann.js");
const { aeroCoefficients } = await import("../src/utils.js");

const lift = [0, 0.025, 0.15, 0.9, 1.3, 1.46, 1.52, 1.51, 1.45, 1.41, 1.33, 1.16, 0.95, 0.82, 0.73, 0.6, 0.43, 0.34, 0.28, 0.28, 0.28];
const drag = [0.15, 0.15, 0.15, 0.16, 0.172, 0.19, 0.22, 0.25, 0.29, 0.34, 0.4, 0.47, 0.55, 0.635, 0.73, 0.83, 0.95, 1.1, 1.28, 1.28, 1.28];

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL", message);
    process.exitCode = 1;
    throw new Error(message);
  }
}

function firstBad(bm) {
  const see = (cells, where) => {
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (!c || !Number.isFinite(c.ux) || !Number.isFinite(c.uy) || !Number.isFinite(c.rho) || !Number.isFinite(c.f0)) {
        return { where, i, ux: c && c.ux, rho: c && c.rho };
      }
    }
    return null;
  };
  let bad = see(bm.cells, "coarse");
  if (bad) return bad;
  const walk = (domains, prefix) => {
    for (let i = 0; i < domains.length; i++) {
      bad = see(domains[i].cells, prefix + i);
      if (bad) return bad;
      bad = walk(domains[i].domains, prefix + i + ".");
      if (bad) return bad;
    }
    return null;
  };
  return walk(bm.domains, "d");
}

// 1. Dead-aft apparent wind must not produce NaN coefficients.
for (const diff of [0, 80, 99.9, 100, 180]) {
  const c = aeroCoefficients(diff, lift, drag, 5);
  assert(Number.isFinite(c.lift) && Number.isFinite(c.drag), "aero " + diff + " " + JSON.stringify(c));
}

// 2. Sampler never throws and never returns a non-finite velocity,
//    including NaN probes and a punched-out cell.
const bm = new Boltzmann(75, 75, 1, 90, 15, undefined, 4);
bm.addDomain(30, 30, 55, 55);
const level1 = bm.domains[0];
level1.addDomain(20, 20, 45, 45);

for (const [x, y] of [[NaN, 0], [0, NaN], [undefined, 1], [1e9, -1e9], [0, 0], [33, 34]]) {
  let v;
  try {
    v = bm.get_field_velocity(x, y);
  } catch (e) {
    assert(false, "sample threw " + e.message + " at " + x + "," + y);
  }
  assert(v && Number.isFinite(v.x) && Number.isFinite(v.y), "sample " + x + "," + y + " -> " + JSON.stringify(v));
}

const punched = level1.cells[20 + 20 * level1.width];
level1.cells[20 + 20 * level1.width] = undefined;
const wx = (level1.cx0 + 10) - bm.width / 2;
const wy = (level1.cy0 + 10) - bm.height / 2;
let punchedSample;
try {
  punchedSample = bm.get_field_velocity(wx, wy);
} catch (e) {
  assert(false, "punched cell threw " + e.message);
}
assert(punchedSample && Number.isFinite(punchedSample.x) && Number.isFinite(punchedSample.y), "punched sample");
level1.cells[20 + 20 * level1.width] = punched;

// NaN sail endpoints and a collapsed density must not throw on .ux / .setEquil.
bm.apply_energy(NaN, NaN, 1, 1);
bm.apply_energy_segment(NaN, 0, 1, 1, 1, 1);
bm.apply_energy_segment(0, 0, 1, 0, NaN, 1);
const victim = bm.cells[40 + 40 * bm.width];
victim.f0 = victim.fN = victim.fS = victim.fE = victim.fW = 0;
victim.fNE = victim.fNW = victim.fSE = victim.fSW = 0;
victim.rho = 0;
bm.physics_model_step();
assert(!firstBad(bm), "zero-density cell stayed non-finite " + JSON.stringify(firstBad(bm)));

// 3. The toggle: domains exist, boats sail off in dev mode (no stepping),
//    then the domains are moved onto the north/east edge and the fluid resumes.
//    A stationary sail-scale force for longer than the old blow-up (~170
//    double-steps) must leave every macro finite, and sampling must not throw.
function place(index, cx, cy) {
  const cx0 = Math.max(1, cx - 20);
  const cy0 = Math.max(1, cy - 20);
  const cx1 = Math.min(bm.width - 1, cx + 20);
  const cy1 = Math.min(bm.height - 1, cy + 20);
  if (index >= bm.domains.length) bm.addDomain(cx0, cy0, cx1, cy1);
  else bm.moveDomain(index, cx0, cy0, cx1, cy1);
  const parent = bm.domains[index];
  const fi = 1 + (cx - parent.cx0) * 2;
  const fj = 1 + (cy - parent.cy0) * 2;
  const x0 = Math.max(1, Math.min(parent.width - 3, Math.round(fi - 20)));
  const y0 = Math.max(1, Math.min(parent.height - 3, Math.round(fj - 20)));
  const x1 = Math.max(x0 + 2, Math.min(parent.width - 1, Math.round(fi + 20)));
  const y1 = Math.max(y0 + 2, Math.min(parent.height - 1, Math.round(fj + 20)));
  if (parent.domains.length === 0) parent.addDomain(x0, y0, x1, y1);
  else parent.moveDomain(0, x0, y0, x1, y1);
}

place(0, 40, 40);
for (let i = 0; i < 10; i++) bm.physics_model_step();
// Dev mode: boats run to the north-east wall, lattice frozen.
place(0, 72, 72);
const sailX = 72 - bm.width / 2;
const sailY = 72 - bm.height / 2;
for (let frame = 0; frame < 250; frame++) {
  bm.apply_energy_segment(sailX, sailY, sailX + 1.6, sailY + 0.3, 0.0054, -0.001);
  bm.physics_model_step();
  bm.apply_energy_segment(sailX, sailY, sailX + 1.6, sailY + 0.3, 0.0054, -0.001);
  bm.physics_model_step();
  const bad = firstBad(bm);
  assert(!bad, "lattice NaN at frame " + frame + " " + JSON.stringify(bad));
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const v = bm.get_field_velocity(sailX + dx, sailY + dy);
      assert(Number.isFinite(v.x) && Number.isFinite(v.y), "wind NaN at frame " + frame);
    }
  }
}

// A boat past the lattice must not throw while placing domains.
assert(bm.addDomain(80, 80, 60, 60) === undefined, "inverted addDomain");
bm.moveDomain(0, -40, 90, -10, 100);
assert(!firstBad(bm), "field after rejected move");

// Level-2 inverted box is a no-op, not RangeError.
const parent = bm.domains[0];
const before = parent.domains.length;
parent.addDomain(40, 40, 10, 10);
assert(parent.domains.length === before, "inverted level-2 was added");

console.log("ok");
