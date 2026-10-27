// Own-sail-force true-wind correction (wind.js correctWindOwnForce / boatTrueWind).
import './dom-stub.mjs';
const {
  windSample, correctWindOwnForce, boatTrueWind, ConstantWind,
  getTrueWindOwnForceK, setTrueWindOwnForceK, TRUE_WIND_OWN_FORCE_K,
} = await import('../src/wind.js');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const near = (a, b, e = 1e-12) => Math.abs(a - b) <= e;

{
  const s = windSample(0.01, -0.02);
  const out = correctWindOwnForce(s, null);
  check('null force: sample unchanged', out === s || (out.vx === s.vx && out.vy === s.vy));
}
{
  const s = windSample(0.01, 0);
  const out = correctWindOwnForce(s, { x: 10, y: 0 }, 0.001);
  // u_est = u_meas + k * F_boat
  check('adds k·F_boat to lattice vx', near(out.vx, 0.01 + 0.001 * 10) && near(out.vy, 0));
}
{
  const s = windSample(0.01, 0.02);
  const out = correctWindOwnForce(s, { x: 0, y: 0 }, 0.001);
  check('zero force: returns same sample object', out === s);
}
{
  const s = windSample(0.01, 0);
  check('k = 0: unchanged', correctWindOwnForce(s, { x: 5, y: 0 }, 0) === s);
}
{
  check('default k is the fitted 2f constant', near(getTrueWindOwnForceK(), 0.000105, 1e-15) && near(TRUE_WIND_OWN_FORCE_K, 0.000105, 1e-15));
}
{
  const prev = getTrueWindOwnForceK();
  setTrueWindOwnForceK(0.0002);
  check('setTrueWindOwnForceK updates the live default', near(getTrueWindOwnForceK(), 0.0002));
  setTrueWindOwnForceK(prev);
}
{
  // Dev mode (ConstantWind): boatTrueWind must not apply the force correction.
  const cw = new ConstantWind(90, 4.5);
  const boat = { x: 0, y: 0, map: { devMode: true, get_wind_ring: (x, y) => cw.getWind(x, y), get_wind: (x, y) => cw.getWind(x, y) }, mainsail_force: { x: 100, y: 0 } };
  const w = boatTrueWind(boat);
  const raw = cw.getWind(0, 0);
  check('dev mode: no force correction', w.vx === raw.vx && w.vy === raw.vy && w.speed === raw.speed);
}
{
  const base = windSample(0.01, 0);
  const boat2f = {
    x: 0, y: 0,
    map: { devMode: false, bm: { velScale: 2 }, get_wind_ring: () => base, get_wind: () => base },
    mainsail_force: { x: 20, y: -10 },
  };
  const w = boatTrueWind(boat2f, 0.001);
  check('boatTrueWind on 2f applies +k·F', near(w.vx, 0.01 + 0.02) && near(w.vy, -0.01));
  const boat1 = {
    x: 0, y: 0,
    map: { devMode: false, bm: { velScale: 1 }, get_wind_ring: () => base, get_wind: () => base },
    mainsail_force: { x: 20, y: -10 },
  };
  const w1 = boatTrueWind(boat1, 0.001);
  check('boatTrueWind on Default (velScale 1): no correction', w1.vx === base.vx && w1.vy === base.vy);
}
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all truewind-force checks passed');
