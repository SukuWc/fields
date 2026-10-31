// autopilotSnapTarget (shared by the Space toggle and the dashed preview) + preview guide.
import { autopilotSnapTarget, boatGuides, AUTOPILOT_PREVIEW_LENGTH } from '../src/boat-draw.js';
let failed = 0;
const ok = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) failed++; };
const cases = [[80,90],[100,90],[-80,-90],[-100,-90],[79.9,50],[100.1,160],[0,50],[30,50],[-60,-50],[150,160],[-170,-160],[180,160]];
for (const [t, w] of cases) ok(autopilotSnapTarget(t) === w, `snap ${t} -> ${autopilotSnapTarget(t)} (want ${w})`);
ok(autopilotSnapTarget(40, 45, 150) === 45 && autopilotSnapTarget(-120, 45, 150) === -150, 'custom best-VMG angles');
const s = { x: 0, y: 0, px: 0, py: 0, pa: 0, ha: 0, awa: 30, tw: 0, ap: 1, wd: 0, aht: 50, twa: -85, ra: 0, mba: 0, jba: 0, mf: 0, jf: 0, ph: 0, f: [] };
const d = { rp: 0, rl: 1, cp: 0, cl: 1, mle: 0, mbl: 1, jle: 0, jbl: 1 };
const g = boatGuides(s, d).filter((x) => x.role === 'ap-preview');
ok(g.length > 3, 'preview drawn as several dash segments while autopilot on');
const far = g[g.length - 1], ang = Math.atan2(far.y2, far.x2) * 180 / Math.PI;
ok(Math.abs(ang - 90) < 1e-6, `preview uses current TWA (85 -> 90), got ${ang}`);
ok(Math.hypot(far.x2, far.y2) > 12 && Math.hypot(far.x2, far.y2) <= AUTOPILOT_PREVIEW_LENGTH, 'preview longer than target line');
const g2 = boatGuides({ ...s, ap: 0, aht: -30, twa: undefined }, d).filter((x) => x.role === 'ap-preview');
const a2 = Math.atan2(g2.at(-1).y2, g2.at(-1).x2) * 180 / Math.PI;
ok(Math.abs(a2 + 50) < 1e-6, `fallback to aht when twa missing, got ${a2}`);
if (failed) { console.error(failed + ' failed'); process.exit(1); }
