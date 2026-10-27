// Own-sail-force true-wind correction (wind.js correctWindOwnForce / boatTrueWind).
import './dom-stub.mjs';
const {
  windSample, correctWindOwnForce, boatTrueWind, ConstantWind,
  getTrueWindOwnForceK, setTrueWindOwnForceK, TRUE_WIND_OWN_FORCE_K,
  TRUE_WIND_OWN_FORCE_GAIN_REF, TRUE_WIND_OWN_FORCE_K_BY_GAIN, trueWindOwnForceKEff,
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
    map: { devMode: false, bm: { velScale: 2 }, sailWakeGain: 16, get_wind_ring: () => base, get_wind: () => base },
    mainsail_force: { x: 12, y: -5 },
  };
  const w = boatTrueWind(boat2f, 0.001);
  check('boatTrueWind on 2f applies +k·F', near(w.vx, 0.01 + 0.012) && near(w.vy, -0.005));
  const boat1 = {
    x: 0, y: 0,
    map: { devMode: false, bm: { velScale: 1 }, get_wind_ring: () => base, get_wind: () => base },
    mainsail_force: { x: 20, y: -10 },
  };
  const w1 = boatTrueWind(boat1, 0.001);
  check('boatTrueWind on Default (velScale 1): no correction', w1.vx === base.vx && w1.vy === base.vy);
}


{
  check('GAIN_REF matches default sail wake gain (16)', TRUE_WIND_OWN_FORCE_GAIN_REF === 16);
  check('k table has knots at 0/10/16/25', TRUE_WIND_OWN_FORCE_K_BY_GAIN.map((p) => p[0]).join(',') === '0,10,16,25');
  check('kEff at gain 16 equals k0', near(trueWindOwnForceKEff(16, 0.000105), 0.000105));
  check('kEff at gain 0 is 0', near(trueWindOwnForceKEff(0, 0.000105), 0));
  check('kEff at gain 10 is table knot', near(trueWindOwnForceKEff(10, 0.000105), 0.00006));
  check('kEff at gain 25 is table knot', near(trueWindOwnForceKEff(25, 0.000105), 0.00018));
  // Between 0 and 10: linear from 0 → 6e-5
  check('kEff at gain 8 interpolates 0→10', near(trueWindOwnForceKEff(8, 0.000105), 0.000048));
  // Past 25: same slope as 16→25 → +7.5e-5 per +9 gain → at 34 = 1.8e-4 + 7.5e-5
  check('kEff past 25 extrapolates 16→25 slope', near(trueWindOwnForceKEff(34, 0.000105), 0.000255));
  // setTrueWindOwnForceK doubles the whole map
  check('kEff scales with setTrueWindOwnForceK', near(trueWindOwnForceKEff(16, 0.00021), 0.00021) && near(trueWindOwnForceKEff(10, 0.00021), 0.00012));
}
{
  const base = windSample(0.01, 0);
  const mk = (gain) => ({
    x: 0, y: 0,
    map: { devMode: false, bm: { velScale: 2 }, sailWakeGain: gain, get_wind_ring: () => base, get_wind: () => base },
    mainsail_force: { x: 10, y: 0 },
  });
  // Pass k = table's gain-16 value so kEff equals the table entries.
  const w16 = boatTrueWind(mk(16), 0.000105);
  const w10 = boatTrueWind(mk(10), 0.000105);
  const w25 = boatTrueWind(mk(25), 0.000105);
  const w0 = boatTrueWind(mk(0), 0.000105);
  check('boatTrueWind uses gain→k table',
    near(w16.vx, 0.01 + 0.000105 * 10) &&
    near(w10.vx, 0.01 + 0.00006 * 10) &&
    near(w25.vx, 0.01 + 0.00018 * 10) &&
    near(w0.vx, 0.01));
}
{
  const s = windSample(0.01, 0);
  const out = correctWindOwnForce(s, { x: 400, y: 0 }, 0.001, 20);
  check('force cap clamps |F| before k·F', near(out.vx, 0.01 + 0.001 * 20) && near(out.vy, 0));
}
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all truewind-force checks passed');
