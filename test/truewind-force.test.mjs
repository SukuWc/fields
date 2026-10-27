// Own-sail-force true-wind correction (wind.js correctWindOwnForce / boatTrueWind).
import './dom-stub.mjs';
const {
  windSample, correctWindOwnForce, boatTrueWind, ConstantWind,
  getTrueWindOwnForceK, setTrueWindOwnForceK, TRUE_WIND_OWN_FORCE_K,
  TRUE_WIND_OWN_FORCE_GAIN_REF, TRUE_WIND_OWN_FORCE_K_BY_GAIN, TRUE_WIND_OWN_FORCE_BY_GAIN,
  trueWindOwnForceKEff, trueWindOwnForceCoeffs, boatSpeedAcc,
  setTrueWindOwnForceCoeffsOverride,
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
  const k16 = TRUE_WIND_OWN_FORCE_BY_GAIN.find((p) => p.gain === 16).k0;
  check('default k tracks gain-16 k0', near(getTrueWindOwnForceK(), k16, 1e-15) && near(TRUE_WIND_OWN_FORCE_K, k16, 1e-15));
}
{
  const prev = getTrueWindOwnForceK();
  setTrueWindOwnForceK(0.0002);
  check('setTrueWindOwnForceK updates the live default', near(getTrueWindOwnForceK(), 0.0002));
  setTrueWindOwnForceK(prev);
}
{
  const cw = new ConstantWind(90, 4.5);
  const boat = { x: 0, y: 0, map: { devMode: true, get_wind: (x, y) => cw.getWind(x, y) }, mainsail_force: { x: 100, y: 0 } };
  const w = boatTrueWind(boat);
  const raw = cw.getWind(0, 0);
  check('dev mode: no force correction', w.vx === raw.vx && w.vy === raw.vy && w.speed === raw.speed);
}
{
  const base = windSample(0.01, 0);
  const k16 = TRUE_WIND_OWN_FORCE_BY_GAIN.find((p) => p.gain === 16).k0;
  const boat2f = {
    x: 0, y: 0,
    map: { devMode: false, bm: { velScale: 2 }, sailWakeGain: 16, _trueWindUndoStep: 1, get_wind: () => base },
    mainsail_force: { x: 12, y: -5 },
    physics_model: { m_linearVelocity: { x: 0, y: 0 } },
  };
  // First call seeds acc=0 → k_eff = k0
  const w = boatTrueWind(boat2f, k16);
  check('boatTrueWind on 2f applies +(k0)·F at acc=0', near(w.vx, 0.01 + k16 * 12) && near(w.vy, -k16 * 5));
  const boat1 = {
    x: 0, y: 0,
    map: { devMode: false, bm: { velScale: 1 }, get_wind: () => base },
    mainsail_force: { x: 20, y: -10 },
  };
  const w1 = boatTrueWind(boat1, 0.001);
  check('boatTrueWind on Default (velScale 1): no correction', w1.vx === base.vx && w1.vy === base.vy);
}

{
  check('GAIN_REF matches default sail wake gain (16)', TRUE_WIND_OWN_FORCE_GAIN_REF === 16);
  check('coeff table has knots at 0/10/16/25', TRUE_WIND_OWN_FORCE_BY_GAIN.map((p) => p.gain).join(',') === '0,10,16,25');
  check('K_BY_GAIN mirrors k0 column', TRUE_WIND_OWN_FORCE_K_BY_GAIN.map((p) => p[0]).join(',') === '0,10,16,25');
  const k16 = TRUE_WIND_OWN_FORCE_BY_GAIN.find((p) => p.gain === 16).k0;
  const k10 = TRUE_WIND_OWN_FORCE_BY_GAIN.find((p) => p.gain === 10).k0;
  const k25 = TRUE_WIND_OWN_FORCE_BY_GAIN.find((p) => p.gain === 25).k0;
  const a16 = TRUE_WIND_OWN_FORCE_BY_GAIN.find((p) => p.gain === 16).ka;
  const a10 = TRUE_WIND_OWN_FORCE_BY_GAIN.find((p) => p.gain === 10).ka;
  check('kEff at gain 16, acc 0 equals k0', near(trueWindOwnForceKEff(16, 0, k16), k16));
  check('kEff at gain 0 is 0', near(trueWindOwnForceKEff(0, 0, k16), 0));
  check('kEff at gain 10, acc 0 is table k0', near(trueWindOwnForceKEff(10, 0, k16), k10));
  check('kEff at gain 25, acc 0 is table k0', near(trueWindOwnForceKEff(25, 0, k16), k25));
  check('kEff adds ka·acc', near(trueWindOwnForceKEff(16, 1, k16), k16 + a16));
  check('legacy kEff(gain, k) is base k0', near(trueWindOwnForceKEff(16, k16), k16));
  // Between 0 and 10: linear from 0 → k10
  check('kEff at gain 8 interpolates 0→10', near(trueWindOwnForceKEff(8, 0, k16), k10 * 0.8));
  // Past 25: same slope as 16→25 on k0
  const k34 = k25 + (k25 - k16) * (34 - 25) / (25 - 16);
  check('kEff past 25 extrapolates 16→25 slope', near(trueWindOwnForceKEff(34, 0, k16), k34));
  check('kEff scales with setTrueWindOwnForceK', near(trueWindOwnForceKEff(16, 0, 2 * k16), 2 * k16) && near(trueWindOwnForceKEff(10, 0, 2 * k16), 2 * k10));
  const c = trueWindOwnForceCoeffs(16, k16);
  check('coeffs expose k0 and ka', near(c.k0, k16) && near(c.ka, a16));
  check('ka at gain 10 is table knot', near(trueWindOwnForceCoeffs(10, k16).ka, a10));
}
{
  const base = windSample(0.01, 0);
  const k16 = TRUE_WIND_OWN_FORCE_BY_GAIN.find((p) => p.gain === 16).k0;
  const a16 = TRUE_WIND_OWN_FORCE_BY_GAIN.find((p) => p.gain === 16).ka;
  const mk = (gain, step, vx) => ({
    x: 0, y: 0,
    map: { devMode: false, bm: { velScale: 2 }, sailWakeGain: gain, _trueWindUndoStep: step, get_wind: () => base },
    mainsail_force: { x: 10, y: 0 },
    physics_model: { m_linearVelocity: { x: vx, y: 0 } },
  });
  const b0 = mk(16, 1, 0);
  boatTrueWind(b0, k16); // seed
  const b1 = mk(16, 2, 1); // |v| 0 → 1 in 1/30 s → acc = 30
  // Reuse same boat object so WeakMap state carries
  b0.map._trueWindUndoStep = 2;
  b0.physics_model.m_linearVelocity.x = 1;
  const wAcc = boatTrueWind(b0, k16);
  const kEff = k16 + a16 * 30;
  check('boatTrueWind modulates k by acc', near(wAcc.vx, 0.01 + kEff * 10, 1e-9));
  // Same step re-entry reuses acc
  const acc1 = boatSpeedAcc(b0);
  const acc2 = boatSpeedAcc(b0);
  check('boatSpeedAcc stable within a step', near(acc1, 30) && near(acc2, 30));
}
{
  setTrueWindOwnForceCoeffsOverride({ k0: 1e-4, ka: 2e-4 });
  const c = trueWindOwnForceCoeffs(16);
  check('coeff override wins over table', near(c.k0, 1e-4) && near(c.ka, 2e-4));
  setTrueWindOwnForceCoeffsOverride(null);
}
{
  const s = windSample(0.01, 0);
  const out = correctWindOwnForce(s, { x: 400, y: 0 }, 0.001, 20);
  check('force cap clamps |F| before k·F', near(out.vx, 0.01 + 0.001 * 20) && near(out.vy, 0));
}
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all truewind-force checks passed');
