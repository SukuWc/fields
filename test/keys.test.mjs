// W / S camera zoom keys (src/controls.js) and the autopilot heading-target
// step for held Up / Down (src/boat.js).
import './dom-stub.mjs';
const { zoomKeyStep, ZOOM_IN_KEY, ZOOM_OUT_KEY } = await import('../src/controls.js');
const { AUTOPILOT_HEADING_STEP_DEG, RUDDER_RETURN_SPEEDUP } = await import('../src/boat.js');
const { SimCore } = await import('../src/host.js');

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

check('W = zoom in, S = zoom out (same -2/+2 step as the +/- buttons)', ZOOM_IN_KEY === 87 && ZOOM_OUT_KEY === 83 && zoomKeyStep(87, 1) === -2 && zoomKeyStep(83, 0) === +2);
check('other keys do not zoom', zoomKeyStep(38, 1) === 0 && zoomKeyStep(65, 1) === 0);
check('W / S keep steering boat 2 when two local boats are bound', zoomKeyStep(87, 2) === 0 && zoomKeyStep(83, 2) === 0);

check('autopilot heading step is 1.5° per tick (was 1°)', AUTOPILOT_HEADING_STEP_DEG === 1.5);
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f' });
  core.command({ type: 'restart', scenario: 0 });
  core.tick({ dt: 1 / 30, held: [], present: false, view: {} });
  const b = core.sim.players[0];
  b.autopilot_heading_target = 45;
  b.input_autopilot_heading_increase();
  check('increase adds 1.5°', Math.abs(b.autopilot_heading_target - 46.5) < 1e-9, b.autopilot_heading_target);
  b.autopilot_heading_target = -45;
  b.input_autopilot_heading_decrease();
  check('decrease on port tack moves toward the wind by 1.5°', Math.abs(b.autopilot_heading_target + 43.5) < 1e-9, b.autopilot_heading_target);
  b.autopilot_heading_target = 174.5;
  b.input_autopilot_heading_increase();
  check('clamped at 175°', b.autopilot_heading_target === 175);
  b.autopilot_heading_target = 5.5;
  b.input_autopilot_heading_decrease();
  check('clamped at 5°', b.autopilot_heading_target === 5);
}

check('rudder return-to-centre is 3x faster (decay factor cubed)', RUDDER_RETURN_SPEEDUP === 3);

check('= / - (and numpad, Firefox codes) zoom in every mode, even with two boats bound', [187, 61, 107].every((k) => zoomKeyStep(k, 0) === -2 && zoomKeyStep(k, 2) === -2) && [189, 173, 109].every((k) => zoomKeyStep(k, 1) === +2 && zoomKeyStep(k, 2) === +2));
const { cameraTarget } = await import('../src/view.js');
check('camera target: none, one boat, midpoint of two', cameraTarget([]) === null && cameraTarget([{ x: 3, y: 4 }]).x === 3 && JSON.stringify(cameraTarget([{ x: 0, y: 10 }, { x: 10, y: -4 }])) === '{"x":5,"y":3}');

if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
console.log('all keys checks passed');
