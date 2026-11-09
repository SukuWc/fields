// Space snaps to the nearest of upwind best-VMG (50°), beam (90°) and downwind
// best-VMG (160°) on the same tack. A tie goes to the larger absolute angle.
import './dom-stub.mjs';
await import('./full-stack.mjs');
const H = await import('../scripts/sim-res-harness.mjs');
const { Boat } = await import('../src/boat.js');
let failed = 0;
const { map } = H.makeWorld(1);
const b = new Boat(map, 10, -9, 5 * Math.PI / 4);
const cases = [[68,50],[70,90],[80,90],[85,90],[90,90],[100,90],[100.1,90],[125,160],[145,160],[150,160],[-68,-50],[-70,-90],[-80,-90],[-95,-90],[-100.1,-90],[-145,-160],[30,50],[-60,-50],[-170,-160]];
for (const [t, want] of cases) {
  b.autopilot_enabled = false; b.autopilot_heading_target = t;
  b.input_autopilot_enabled_toggle();
  const ok = b.autopilot_enabled && b.autopilot_heading_target === want;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + `engage at ${t} -> ${b.autopilot_heading_target} (want ${want})`);
  if (!ok) failed++;
}
if (failed) { console.error(failed + ' failed'); process.exit(1); }
