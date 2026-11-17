// Desktop three-column HUD helpers (index.html, "Desktop three-column HUD").
// The layout itself is CSS (#hud_grid); this module adds the two pieces CSS
// cannot do on its own:
// - bp-desktop-compact (a desktop window under 1158 px): the minimap column
//   collapses to the Map button (#mm_toggle). The button toggles
//   body.mm-expanded, which widens the left column to 160 px and shows the
//   minimap there (the instrument panel gives up the width, nothing overlaps).
//   The choice is kept in this browser (localStorage 'fields.mmExpanded').
// - --ip-live on <body>: the instrument zone's current height, so the touch
//   controls overlay can sit just above the panel whatever its mode
//   (Readout / Chart / Player menu, wrapped tiles).

export const MM_STORE_KEY = 'fields.mmExpanded';

export function setupDesktopHud(doc = document, win = typeof window !== 'undefined' ? window : null) {
  const body = doc.body;
  const toggle = doc.getElementById('mm_toggle');
  const store = win && win.localStorage;
  const read = () => { try { return store ? store.getItem(MM_STORE_KEY) : null; } catch { return null; } };
  const setExpanded = (on, remember = true) => {
    body.classList.toggle('mm-expanded', on);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(on));
      toggle.textContent = on ? 'Hide map' : 'Map';
      toggle.title = on ? 'Hide the minimap' : 'Show the minimap';
    }
    if (remember) { try { if (store) store.setItem(MM_STORE_KEY, on ? '1' : '0'); } catch { /* private mode */ } }
  };
  setExpanded(read() === '1', false);
  if (toggle) toggle.addEventListener('click', () => setExpanded(!body.classList.contains('mm-expanded')));

  const zone = doc.getElementById('hud_instruments');
  const publish = () => {
    if (!zone) return;
    const h = zone.getBoundingClientRect().height;
    if (h > 0) body.style.setProperty('--ip-live', Math.round(h) + 'px');
  };
  if (zone && win && typeof win.ResizeObserver === 'function') new win.ResizeObserver(publish).observe(zone);
  publish();
  return { setExpanded, publish };
}
