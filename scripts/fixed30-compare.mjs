// Old (3 passes per world step) vs new (1 pass per tick) headless comparison.
// node --import <root>/test/register.mjs cmp30.mjs <root> <passes> <what>
const [root, P0, what] = process.argv.slice(2); const P = +P0;
await import(root + '/test/dom-stub.mjs'); // usage: node --import <root>/test/register.mjs scripts/fixed30-compare.mjs <root> <passes 3=old,1=new> s0|s0nokick|shadow|fleet4|penalty
const { Boltzmann } = await import(root + '/src/boltzmann.js');
const { trackBoats } = await import(root + '/src/domainTrack.js');
const { SAIL_LATTICE_COUPLING, Boat } = await import(root + '/src/boat.js');
const { Map } = await import(root + '/src/map.js');
const H = await import(root + '/scripts/sim-res-harness.mjs');
const now = () => performance.now();
function world() { const { bm, map } = H.makeWorld(1); return { bm, map }; }
// One 30 Hz tick: world.step, then P passes of boats + sail kicks + field.
function tick(map, bm, boats, kick) {
  map.world.step(1 / 30);
  let ms = 0;
  for (let p = 0; p < P; p++) {
    boats.forEach((b, i) => {
      b.physics_model_step();
      if ((!kick || kick[i]) && b.mainsail_force) {
        const eff = SAIL_LATTICE_COUPLING * bm.resolution * bm.resolution / (bm.velScale ?? 1);
        for (const s of b.getSailSegments()) bm.apply_energy_segment(s.x0, s.y0, s.x1, s.y1, s.fx * eff, s.fy * eff);
      }
    });
    const t0 = now();
    if (bm.stepsDueThisFrame() > 0) trackBoats(bm, boats);
    bm.advance_frame();
    ms += now() - t0;
  }
  return ms;
}
const spd = b => Math.hypot(b.physics_model.m_linearVelocity.x, b.physics_model.m_linearVelocity.y);
const out = { root: root.split('/').pop(), P, what };
if (what === 's0') {
  const { bm, map } = world(); const b = new Boat(map, 10, -9, 5 * Math.PI / 4);
  let tackAt = 400, tackDone = null, before = null; const T = 700;
  for (let t = 0; t < T; t++) {
    if (t === 1) b.input_autopilot_enabled_toggle();
    if (t === 200) { out.twa200 = b.twa; out.bs200 = spd(b); }
    if (t === tackAt) { before = Math.sign(b.twa); b.input_autopilot_tack_toggle(); }
    tick(map, bm, [b]);
    if (before !== null && tackDone === null && Math.sign(b.twa) === -before && Math.abs(b.twa) > 45) tackDone = t - tackAt;
  }
  out.twaEnd = b.twa; out.bsEnd = spd(b); out.tackTicks = tackDone; out.tackS = tackDone && +(tackDone / 30).toFixed(2);
} else if (what === 's0nokick') {
  const { bm, map } = world(); const b = new Boat(map, 10, -9, 5 * Math.PI / 4);
  for (let t = 0; t < 300; t++) { if (t === 1) b.input_autopilot_enabled_toggle(); tick(map, bm, [b], [false]); }
  out.twa = b.twa; out.bs = spd(b); out.tws = b.wind_speed;
} else if (what === 'shadow') {
  const run = kick => { const { bm, map } = world(); const bs = [new Boat(map, 12, -6, 5 * Math.PI / 4), new Boat(map, 15, -11.5, 5 * Math.PI / 4)]; let tw = [0, 0], n = 0;
    for (let t = 0; t < 300; t++) { if (t === 1) bs.forEach(b => b.input_autopilot_enabled_toggle()); tick(map, bm, bs, kick); if (t >= 200) { tw[0] += bs[0].wind_speed; tw[1] += bs[1].wind_speed; n++; } }
    return tw.map(v => v / n); };
  const on = run(null), off = run([false, true]);
  out.tws = on; out.shadow = +(off[1] - on[1]).toFixed(4);
} else if (what === 'fleet4') {
  const { bm, map } = world(); const bs = H.FLEET4.map(([x, y, h]) => new Boat(map, x, y, h)); let ms = 0;
  const t0 = now();
  for (let t = 0; t < 300; t++) { if (t === 1) bs.forEach(b => b.input_autopilot_enabled_toggle()); const m = tick(map, bm, bs); if (t >= 50) ms += m; }
  out.fieldMsPerTick = +(ms / 250).toFixed(1); out.wallMsPerTick = +((now() - t0) / 300).toFixed(1); out.twa = bs.map(b => +b.twa.toFixed(1)); out.bs = bs.map(b => +spd(b).toFixed(2));
} else if (what === 'penalty') {
  const { bm, map } = world(); const b = new Boat(map, 10, -9, 5 * Math.PI / 4);
  let t0 = null, done = null, h0 = 0, maxOver = 0;
  for (let t = 0; t < 900; t++) {
    if (t === 1) b.input_autopilot_enabled_toggle();
    if (t === 300) { b.input_penalty_turn_ccw(); t0 = t; h0 = b.physics_model.getAngle(); }
    tick(map, bm, [b]);
    if (t0 !== null && done === null && t > t0 && !b.penalty_turn) { done = t - t0; }
    if (done !== null && t < t0 + done + 60) { let d = (b.physics_model.getAngle() - h0) * 180 / Math.PI; d = ((d % 360) + 540) % 360 - 180; maxOver = Math.max(maxOver, Math.abs(d)); }
  }
  out.penaltyTicks = done; out.penaltyS = done && +(done / 30).toFixed(2); out.headingErrAfterDeg = +maxOver.toFixed(2); out.twaEnd = b.twa;
}
console.log('CMP ' + JSON.stringify(out));
