// Race view geometry (index.html #sim_canvas, #mobile_bar, #touch_controls;
// renderer.js resizeRenderer). The WebGL canvas fills exactly the window
// below the top bar: it starts where the bar (plus its 1 px border) ends and
// reaches the bottom edge, or the top of the docked touch-controls panel.
// The bar must not sit over the canvas: Chrome culls canvas rows hidden under
// a full-width opaque layer from the wrong end of the y-flipped GL image,
// which left a bar-high blank band at the bottom edge.
// The CSS lengths are resolved here for concrete windows (a tiny calc()
// evaluator: px, % of the window height, var() with fallbacks, env() = 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rendererSrc = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
// Declarations of the rule whose selector is exactly `sel` (last one wins).
function decls(sel) {
  // The selector must start the rule: right after `}`, `{` (an @media) or `>` (<style>), comments aside.
  const re = new RegExp(`[{}>](?:\\s|/\\*(?:[^*]|\\*(?!/))*\\*/)*${esc(sel)}\\s*\\{([^}]*)\\}`, 'g');
  const out = {};
  let m, found = false;
  while ((m = re.exec(html))) {
    found = true;
    const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
    for (const d of body.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  assert.ok(found, `no CSS rule for ${sel}`);
  return out;
}

// Resolve a CSS length to px. vars: custom properties in scope; H: window height.
function px(expr, vars, H) {
  let s = expr;
  for (let k = 0; k < 10 && /var\(/.test(s); k++) {
    s = s.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name, fb) => {
      if (name in vars) return `(${vars[name]})`;
      assert.ok(fb !== undefined, `undefined ${name} in ${expr}`);
      return `(${fb})`;
    });
  }
  s = s.replace(/env\([^)]*\)/g, '0px').replace(/calc\(/g, '(');
  s = s.replace(/(-?[\d.]+)px/g, '($1)').replace(/(-?[\d.]+)%/g, `($1*${H}/100)`);
  assert.match(s, /^[\d\s.()+\-*/]+$/, `cannot resolve ${expr} -> ${s}`);
  return Function(`return (${s});`)();
}
const borderPx = (v) => (v ? parseFloat(v) : 0);

const canvas = decls('#sim_canvas');
const canvasDocked = decls('body.touch-on #sim_canvas');
const canvasOverlay = decls('body.touch-on.tc-overlay #sim_canvas');
const touchPanel = decls('#touch_controls');
const rootVars = decls(':root');
const overlayVars = decls('body.tc-overlay');

function layout(kind) {
  if (kind === 'desktop') {
    const b = decls('.bp-desktop body'), bar = decls('.bp-desktop #mobile_bar');
    return { vars: { ...rootVars, ...b }, bar };
  }
  const b = decls('.bp-touch body'), bar = decls('.bp-touch #mobile_bar');
  return { vars: { ...rootVars, ...b }, bar };
}

// [layout, touch state, W, H]; touch: none | docked | overlay.
const CASES = [
  ['desktop', 'none', 1920, 1080], ['desktop', 'none', 1440, 900], ['desktop', 'none', 1280, 800],
  ['desktop', 'none', 1024, 640], ['desktop', 'overlay', 1280, 800],
  ['touch', 'overlay', 1024, 768], ['touch', 'docked', 1024, 768], ['touch', 'overlay', 390, 844], ['touch', 'docked', 390, 844],
];

for (const [kind, touch, W, H] of CASES) {
  test(`race canvas fills the window below the top bar: ${kind} ${touch} ${W}x${H}`, () => {
    const { vars: base, bar } = layout(kind);
    const vars = touch === 'overlay' ? { ...base, ...overlayVars } : base;
    // The bar: fixed at the top, full width.
    assert.equal(bar.position, 'fixed');
    assert.equal(px(bar.top, vars, H), 0);
    assert.ok(/left:\s*0/.test(`left: ${bar.left}`) && /^0/.test(bar.right), 'bar spans the full width');
    const barBottom = px(bar.height, vars, H) + borderPx(bar['border-bottom']);
    // The canvas box.
    const height = touch === 'overlay' ? canvasOverlay.height : touch === 'docked' ? canvasDocked.height : canvas.height;
    assert.equal(canvas.position, 'fixed');
    assert.equal(canvas.left, '0');
    assert.equal(canvas.width, '100%');
    const top = px(canvas.top, vars, H);
    const bottom = top + px(height, vars, H);
    assert.equal(top, barBottom, `canvas starts at the bar's bottom edge (${barBottom}px), not under the bar`);
    const want = touch === 'docked' ? H - px(touchPanel.height, vars, H) : H;
    assert.ok(Math.abs(bottom - want) < 1e-6, `canvas bottom ${bottom} must reach ${want} (no gap, no overflow)`);
  });
}

test('drawing buffer follows the canvas box, not the window', () => {
  const fn = rendererSrc.match(/function resizeRenderer\(\) \{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /canvas\.clientWidth/);
  assert.match(fn, /canvas\.clientHeight/);
  assert.match(fn, /camera\.aspect = width \/ height/);
  assert.match(fn, /renderer\.setSize\(width, height, false\)/);
  assert.match(rendererSrc, /new ResizeObserver\(resizeRenderer\)\.observe\(canvas\)/);
});
