// Pinch zoom math (pinch-zoom.js) and View clamp used by the +/- buttons.
// Run: node --import ./test/register.mjs scripts/pinch-zoom-check.mjs
import '../test/dom-stub.mjs';

const { pinchZoomAt } = await import('../src/pinch-zoom.js');
const { View } = await import('../src/view.js');

function assert(cond, message) {
  if (!cond) { console.error('FAIL', message); process.exitCode = 1; throw new Error(message); }
  console.log('ok  ', message);
}

{
  // Spread fingers (dist doubles) → zoom in (camera Z halves).
  const z = pinchZoomAt(30, 100, 200, 10, 70);
  assert(Math.abs(z - 15) < 1e-9, `spread halves Z (got ${z})`);
}

{
  // Pinch fingers (dist halves) → zoom out (camera Z doubles).
  const z = pinchZoomAt(30, 100, 50, 10, 70);
  assert(Math.abs(z - 60) < 1e-9, `pinch doubles Z (got ${z})`);
}

{
  const z = pinchZoomAt(30, 100, 10, 10, 70);
  assert(z === 70, `clamped to zoom max (got ${z})`);
  const z2 = pinchZoomAt(30, 100, 1000, 10, 70);
  assert(z2 === 10, `clamped to zoom min (got ${z2})`);
}

{
  assert(pinchZoomAt(30, 0, 100, 10, 70) === 30, 'zero startDist leaves zoom');
  assert(pinchZoomAt(30, 100, 0, 10, 70) === 30, 'zero dist leaves zoom');
}

{
  // Same min/max the +/- buttons use (View.input_camera_zoom_relative).
  const v = new View();
  assert(v.camera_zoom_min === 10 && v.camera_zoom_max === 70, 'View default zoom limits 10..70');
  v.input_camera_zoom_relative(-2);
  assert(v.camera_zoom < 30, 'zoom in button lowers Z');
  v.camera_zoom = 30;
  v.input_camera_zoom_relative(+2);
  assert(v.camera_zoom > 30, 'zoom out button raises Z');
  v.camera_zoom = 70;
  v.input_camera_zoom_relative(+2);
  assert(v.camera_zoom === 70, 'zoom out clamps at max');
  v.camera_zoom = 10;
  v.input_camera_zoom_relative(-2);
  assert(v.camera_zoom === 10, 'zoom in clamps at min');
}

console.log('pinch-zoom-check: all ok');
