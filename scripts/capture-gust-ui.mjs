import puppeteer from 'puppeteer';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:5173/?worker=0&show_field=1&contrastSlider=2&tracers=0';
const out = process.argv[3] || '/workspace/gust-checkerboard-repro-ui.png';
const waitMs = Number(process.argv[4] || 4500);
const scenario = Number(process.argv[5] || 23);

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-gpu', '--window-size=1400,1000',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  ],
  defaultViewport: { width: 1400, height: 1000 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 60000 });
await page.waitForFunction(() => !!window.__simHost, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 500));

const meta = await page.evaluate(async (scenario) => {
  const host = window.__simHost;
  await host.command({ type: 'refine', maxLevel: 2, boatRefineRadius: 3 });
  await host.command({ type: 'amrMode', mode: 'auto' });
  await host.command({ type: 'cellBudget', tune: true, target: 50000 });
  const r = await host.command({ type: 'restart', scenario });

  // Plot speed, mild contrast
  const plotSelect = document.getElementById('plotSelect');
  const contrastSlider = document.getElementById('contrastSlider');
  if (plotSelect) {
    // 'Plot speed' is index 3
    plotSelect.selectedIndex = 3;
    plotSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (contrastSlider) {
    contrastSlider.value = '2';
    contrastSlider.dispatchEvent(new Event('input', { bubbles: true }));
    contrastSlider.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const f = document.getElementById('show_field');
  if (f && !f.checked) { f.checked = true; f.dispatchEvent(new Event('change', { bubbles: true })); }
  // Disable tracers/trails for cleaner field
  const tracers = document.getElementById('show_field'); // flow tracers may be separate
  const ft = document.querySelector('#flow_tracers, #tracers, input[id*="tracer"]');
  // Boat trails off
  const trails = document.getElementById('boat_trails') || document.querySelector('input[id*="trail"]');
  if (trails && trails.checked) { trails.checked = false; trails.dispatchEvent(new Event('change', { bubbles: true })); }

  // Zoom out via camera if View is reachable through controls
  // Try keyboard-ish: set view zoom on any exposed object
  if (window.__view) window.__view.camera_zoom = 90;

  return { title: r && r.title };
}, scenario);
console.log('meta', meta);

await new Promise((r) => setTimeout(r, waitMs));

// Hide chrome; screenshot full page then also canvas-only crop
await page.evaluate(() => {
  for (const id of ['settings', 'admin_panel', 'player_panel', 'chat_panel', 'admin_scope', 'info', 'conn_banner']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  const bs = document.getElementById('boat_stats_toggle') || document.querySelector('[id*="boat_stats"]');
  if (bs) bs.style.display = 'none';
});

await page.screenshot({ path: out, type: 'png' });

// Canvas-only
const canvasPath = out.replace(/\.png$/, '-canvas.png');
const clip = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (clip && clip.width > 0) {
  await page.screenshot({ path: canvasPath, type: 'png', clip: {
    x: Math.max(0, clip.x), y: Math.max(0, clip.y),
    width: Math.min(clip.width, 1400 - clip.x), height: Math.min(clip.height, 1000 - clip.y),
  }});
  console.log('wrote canvas', canvasPath, fs.statSync(canvasPath).size);
}
console.log('wrote', out, fs.statSync(out).size);
await browser.close();
