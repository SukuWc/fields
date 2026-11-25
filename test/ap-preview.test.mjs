// Dashed autopilot guide: nearer of upwind best-VMG and downwind best-VMG (no beam).
// Space locks that same angle (autopilotSnapTarget / autopilotGuideTarget).
import {
  AUTOPILOT_PREVIEW_LENGTH,
  BEST_VMG_DOWNWIND_DEG,
  BEST_VMG_UPWIND_DEG,
  autopilotGuideTarget,
  autopilotSnapTarget,
  boatGuides,
} from '../src/boat-draw.js';
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) failed++; };
ok(BEST_VMG_UPWIND_DEG === 50 && BEST_VMG_DOWNWIND_DEG === 160,
  'best-VMG constants are the fixed 50° / 160° (no runtime polar)');
// Same tack; no 90° beam snap. Switch at exactly 90° TWA: below → 50,
// 90 and above → 160.
const cases = [
  [0, 50], [30, 50], [50, 50], [68, 50], [70, 50], [80, 50], [89.9, 50],
  [90, 160], [95, 160], [100, 160], [105, 160], [125, 160],
  [145, 160], [150, 160], [160, 160], [170, 160], [180, 160],
  [-30, -50], [-68, -50], [-89.9, -50], [-90, -160], [-104.9, -160], [-125, -160], [-145, -160], [-170, -160],
];
ok(cases.every(([t]) => Math.abs(autopilotSnapTarget(t)) !== 90), 'never snaps to a 90° beam reach');
for (const [t, w] of cases) ok(autopilotSnapTarget(t) === w, `snap ${t} -> ${autopilotSnapTarget(t)} (want ${w})`);
ok(autopilotSnapTarget(40, 45, 150) === 45 && autopilotSnapTarget(-120, 45, 150) === -150 && autopilotSnapTarget(89, 45, 150) === 45 && autopilotSnapTarget(90, 45, 150) === 150, 'custom best-VMG angles');
const s = { x: 0, y: 0, px: 0, py: 0, pa: 0, ha: 0, awa: 30, tw: 0, ap: 1, wd: 0, aht: 68, twa: -68, bv1: 50, bv2: 160, ra: 0, mba: 0, jba: 0, mf: 0, jf: 0, ph: 0, f: [] };
const d = { rp: 0, rl: 1, cp: 0, cl: 1, mle: 0, mbl: 1, jle: 0, jbl: 1 };
const angOf = (segs) => {
  const far = segs[segs.length - 1];
  return Math.atan2(far.y2 - segs[0].y1, far.x2 - segs[0].x1) * 180 / Math.PI;
};
const guides = (state) => boatGuides(state, d);
const g = guides(s).filter((x) => x.role === 'ap-preview');
ok(g.length > 3, 'preview drawn as several dash segments while autopilot on');
ok(Math.abs(angOf(g) - 50) < 1e-6, `holding 68: dashes at nearest snap 50, got ${angOf(g)}`);
const solid = guides(s).find((x) => x.type === 'autopilot');
const solidAng = Math.atan2(solid.y2 - solid.y1, solid.x2 - solid.x1) * 180 / Math.PI;
ok(Math.abs(solidAng - 68) < 1e-6, `holding 68: solid line is the current angle, got ${solidAng}`);
ok(Math.abs(angOf(g) - solidAng) > 10, 'dashes are not a copy of the solid line');
ok(Math.hypot(g.at(-1).x2, g.at(-1).y2) > 12 && Math.hypot(g.at(-1).x2, g.at(-1).y2) <= AUTOPILOT_PREVIEW_LENGTH, 'preview longer than target line');
const broad = guides({ ...s, aht: 145, twa: -145 }).filter((x) => x.role === 'ap-preview');
ok(Math.abs(angOf(broad) - 160) < 1e-6, `broad reach 145: dashes at downwind VMG 160, got ${angOf(broad)}`);
const port = guides({ ...s, ap: 0, aht: -145, twa: 145 }).filter((x) => x.role === 'ap-preview');
ok(Math.abs(angOf(port) + 160) < 1e-6, `port broad reach: dashes at -160, got ${angOf(port)}`);
const beam = guides({ ...s, aht: 90, twa: -90 }).filter((x) => x.role === 'ap-preview');
ok(Math.abs(angOf(beam) - 160) < 1e-6, `beam reach 90: dashes at downwind VMG 160 (switch at 90), got ${angOf(beam)}`);
const below = guides({ ...s, aht: 89, twa: -89 }).filter((x) => x.role === 'ap-preview');
ok(Math.abs(angOf(below) - 50) < 1e-6, `89: dashes at upwind VMG 50, got ${angOf(below)}`);
const onSnap = guides({ ...s, aht: 50, twa: -50 }).filter((x) => x.role === 'ap-preview');
ok(Math.abs(angOf(onSnap) - 50) < 1e-6, `already on 50: dashes show what Space locks (50), got ${angOf(onSnap)}`);
ok(autopilotGuideTarget({ ap: 1, aht: 68, twa: -85, bv1: 50, bv2: 160 }) === 50, 'guide while engaged is the snap of aht, not aht and not live TWA');
ok(autopilotGuideTarget({ ap: 0, aht: 68, twa: -68 }) === autopilotSnapTarget(68), 'guide off equals the Space snap');
ok(autopilotGuideTarget({ ap: 0, aht: -30, twa: undefined }) === -50, 'fallback snaps aht when twa is missing');
if (failed) { console.error(failed + ' failed'); process.exit(1); }
