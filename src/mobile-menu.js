// Mobile settings menu. On small or touch-only screens (see the media query
// in index.html) #settings becomes a slide-in sheet behind the ☰ button.
// The same DOM controls are shown, so URL sync, Reset settings and every
// listener keep working. On desktop (the inverse media query) the same
// button opens and closes #settings as a right-edge overlay drawer; it is
// open by default there and the choice is kept in this browser
// (localStorage 'fields.settingsOpen'). The touch-sheet event isolation
// below applies only to the mobile sheet, so desktop keyboard steering
// still works after clicking a checkbox in the drawer.

const STOP_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'wheel', 'click'];

export function setupMobileMenu() {
  const button = document.getElementById('settings_toggle');
  const panel = document.getElementById('settings');
  const backdrop = document.getElementById('settings_backdrop');
  if (!button || !panel || !backdrop) return;
  backdrop.hidden = false; // shown and hidden by CSS from here on

  const DESKTOP_QUERY = '(min-width: 769px) and (hover: hover), (min-width: 769px) and (pointer: fine)';
  const desktop = typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : { matches: false };
  const STORE_KEY = 'fields.settingsOpen';
  const stored = () => { try { return localStorage.getItem(STORE_KEY); } catch { return null; } };
  const isOpen = () => document.body.classList.contains('settings-open');
  const sheetOpen = () => isOpen() && !desktop.matches;
  function setOpen(open, remember = true) {
    if (remember && desktop.matches) { try { localStorage.setItem(STORE_KEY, open ? '1' : '0'); } catch { /* private mode */ } }
    document.body.classList.toggle('settings-open', open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.textContent = open ? '✕' : '☰';
    button.setAttribute('aria-label', open ? 'Close settings' : 'Settings');
  }

  // Desktop: open by default (the drawer holds Join and Room settings).
  setOpen(desktop.matches && stored() !== '0', false);
  button.addEventListener('click', () => setOpen(!isOpen()));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheetOpen()) setOpen(false);
  });

  // Keep menu touches away from document-level game/camera listeners.
  // Bubble phase on the sheet itself, so the controls' own handlers and the
  // panel-level URL sync (input/change) still run.
  for (const el of [panel, backdrop, button]) {
    for (const type of STOP_EVENTS) {
      el.addEventListener(type, (e) => {
        if (sheetOpen() || el === button) e.stopPropagation();
      }, { passive: true });
    }
  }
  // Typing in a number field must not steer the boat.
  panel.addEventListener('keydown', (e) => {
    if (sheetOpen() && e.key !== 'Escape') e.stopPropagation();
  });
}
