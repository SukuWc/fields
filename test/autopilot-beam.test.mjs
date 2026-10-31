// Autopilot engage snaps: |TWA| in 80..100 (inclusive) -> 90° same side; else close-hauled / run as before.
import './dom-stub.mjs';
await import('./full-stack.mjs');
const H = await import('../scripts/sim-res-harness.mjs');
const { Boat } = await import('../src/boat.js');
let failed = 0;
const { map } = H.makeWorld(1);
const b = new Boat(map, 10, -9, 5 * Math.PI / 4);
const cases = [[80,90],[85,90],[90,90],[100,90],[-80,-90],[-95,-90],[-100,-90],[79.9,50],[100.1,160],[30,50],[150,160],[-60,-50],[-170,-160]];
for (const [t, want] of cases) {
  b.autopilot_enabled = false; b.autopilot_heading_target = t;
  b.input_autopilot_enabled_toggle();
  const ok = b.autopilot_enabled && b.autopilot_heading_target === want;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + `engage at ${t} -> ${b.autopilot_heading_target} (want ${want})`);
  if (!ok) failed++;
}
if (failed) { console.error(failed + ' failed'); process.exit(1); }
