// planck-js rotations (lib/common/Rot.js: setAngle / set / getAngle) call
// sin, cos and atan2 through planck's own Math object, which is
// Object.create(Math). Giving that object the DMath functions makes the
// physics engine deterministic across JS engines too (docs/replay-determinism.md)
// without touching the global Math. Imported for its side effect by map.js,
// which creates the planck World.
import planck from 'planck-js';
import { DMath } from './det-math.js';

const pm = planck.Math;
for (const k of ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'log10', 'log2', 'pow', 'hypot']) {
  pm[k] = DMath[k];
}

export const PLANCK_DET_MATH = true;
