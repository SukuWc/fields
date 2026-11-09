// autopilotSnapTarget + the dashed guide (autopilotGuideTarget).
import { autopilotGuideTarget, autopilotSnapTarget, boatGuides, AUTOPILOT_PREVIEW_LENGTH, penaltyTurnExitTarget } from '../src/boat-draw.js';
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) failed++; };
const cases = [[80,90],[100,90],[-80,-90],[-100,-90],[79.9,50],[100.1,160],[0,50],[30,50],[-60,-50],[150,160],[-170,-160],[180,160]];
for (const [t, w] of cases) ok(autopilotSnapTarget(t) === w, `snap ${t} -> ${autopilotSnapTarget(t)} (want ${w})`);
ok(autopilotSnapTarget(40, 45, 150) === 45 && autopilotSnapTarget(-120, 45, 150) === -150, 'custom best-VMG angles');
const s = { x: 0, y: 0, px: 0, py: 0, pa: 0, ha: 0, awa: 30, tw: 0, ap: 1, wd: 0, aht: 50, twa: -85, ra: 0, mba: 0, jba: 0, mf: 0, jf: 0, ph: 0, f: [] };
const d = { rp: 0, rl: 1, cp: 0, cl: 1, mle: 0, mbl: 1, jle: 0, jbl: 1 };
const angOf = (segs) => {
  const far = segs[segs.length - 1];
  return Math.atan2(far.y2 - segs[0].y1, far.x2 - segs[0].x1) * 180 / Math.PI;
};
const g = boatGuides(s, d).filter((x) => x.role === 'ap-preview');
ok(g.length > 3, 'preview drawn as several dash segments while autopilot on');
const ang = angOf(g);
ok(Math.abs(ang - 50) < 1e-6, `engaged preview is the held target (50), not a re-snap of TWA 85, got ${ang}`);
ok(Math.hypot(g.at(-1).x2, g.at(-1).y2) > 12 && Math.hypot(g.at(-1).x2, g.at(-1).y2) <= AUTOPILOT_PREVIEW_LENGTH, 'preview longer than target line');
const gOff = boatGuides({ ...s, ap: 0, aht: 85, twa: -85 }, d).filter((x) => x.role === 'ap-preview');
ok(Math.abs(angOf(gOff) - 90) < 1e-6, `disengaged preview snaps aht (85 -> 90), got ${angOf(gOff)}`);
const g2 = boatGuides({ ...s, ap: 0, aht: -30, twa: undefined }, d).filter((x) => x.role === 'ap-preview');
ok(Math.abs(angOf(g2) + 50) < 1e-6, `fallback to aht when twa missing, got ${angOf(g2)}`);
const held = boatGuides({ ...s, ap: 1, aht: 68, twa: -85 }, d).filter((x) => x.role === 'ap-preview');
ok(Math.abs(angOf(held) - 68) < 1e-6, `engaged non-snap target stays 68, got ${angOf(held)}`);
const psh = 5 * Math.PI / 4;
const exit = penaltyTurnExitTarget(90, psh);
ok(Math.abs(exit - 45) < 1e-9, `penalty exit target, got ${exit}`);
const gPen = boatGuides({ ...s, ap: 0, wd: 90, aht: 10, twa: -80, psh }, d).filter((x) => x.role === 'ap-preview');
ok(Math.abs(angOf(gPen) - (90 + exit)) < 1e-6, `penalty preview is the exit heading, got ${angOf(gPen)}`);
ok(autopilotGuideTarget({ ap: 0, aht: 85, twa: -85 }) === 90, 'guide target matches the Space snap');
ok(autopilotGuideTarget({ ap: 1, aht: 68, twa: -85 }) === 68, 'guide target while engaged is aht');
if (failed) { console.error(failed + ' failed'); process.exit(1); }
