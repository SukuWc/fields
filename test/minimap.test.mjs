// Minimap math (src/minimap.js).
import { minimapTransform, cameraRect, laylines, xy } from '../src/minimap.js';
let n = 0;
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const check = (name, ok) => { if (!ok) throw new Error('failed: ' + name); n++; };
const t = minimapTransform(75, 150, 320, 256, 6);
check('fits the taller side', near(t.s, 244 / 150));
check('centre maps to the middle', near(t.toPx(0, 0)[0], 160) && near(t.toPx(0, 0)[1], 128));
check('north is up', t.toPx(0, 10)[1] < 128);
const [wx, wy] = t.toWorld(...t.toPx(12, -30));
check('round trip', near(wx, 12) && near(wy, -30));
check('letterbox rect keeps aspect', near(t.rect[2] / t.rect[3], 0.5));
const cr = cameraRect({ camera_zoom: 30, camera_position_x: 5, camera_position_y: -5 }, 2);
check('camera rect centred on the camera', near(cr[0] + cr[2] / 2, 5) && near(cr[1] + cr[3] / 2, -5) && near(cr[2], 2 * cr[3]));
const [a, b] = laylines([0, 0], 0, 10); // wind from north: laylines run south-east / south-west
check('laylines downwind at ±45°', near(a[1], -Math.SQRT1_2 * 10) && near(b[1], -Math.SQRT1_2 * 10) && near(a[0], -b[0]) && near(Math.abs(a[0]), Math.SQRT1_2 * 10));
check('no wind: no laylines', laylines([0, 0], NaN, 10).length === 0);
check('xy accepts arrays and objects', xy([1, 2])[1] === 2 && xy({ x: 3, y: 4 })[0] === 3 && xy(null) === null);
console.log(`all ${n} minimap checks passed`);
