// Mobile settings menu. On small or touch-only screens (see the media query
// in index.html) #settings becomes a slide-in sheet behind the ☰ button.
// The same DOM controls are shown, so URL sync, Reset settings and every
// listener keep working. On desktop the button and backdrop are hidden and
// nothing here changes the panel.

const STOP_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'wheel', 'click'];

export function setupMobileMenu() {
  const button = document.getElementById('settings_toggle');
  const panel = document.getElementById('settings');
  const backdrop = document.getElementById('settings_backdrop');
  if (!button || !panel || !backdrop) return;
  backdrop.hidden = false; // shown and hidden by CSS from here on

  const isOpen = () => document.body.classList.contains('settings-open');
  function setOpen(open) {
    document.body.classList.toggle('settings-open', open);
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.textContent = open ? '✕' : '☰';
    button.setAttribute('aria-label', open ? 'Close settings' : 'Settings');
  }

  button.addEventListener('click', () => setOpen(!isOpen()));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  // Keep menu touches away from document-level game/camera listeners.
  // Bubble phase on the sheet itself, so the controls' own handlers and the
  // panel-level URL sync (input/change) still run.
  for (const el of [panel, backdrop, button]) {
    for (const type of STOP_EVENTS) {
      el.addEventListener(type, (e) => {
        if (isOpen() || el === button) e.stopPropagation();
      }, { passive: true });
    }
  }
  // Typing in a number field must not steer the boat.
  panel.addEventListener('keydown', (e) => {
    if (isOpen() && e.key !== 'Escape') e.stopPropagation();
  });
}
