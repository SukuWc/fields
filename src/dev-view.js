// Dev view: shows the debug-only UI (elements with class "dev-only" in
// index.html: the #info physics readout, the fps counter, and the scenario
// card prose). Off by default. ?dev=1 turns it on at load (?dev=0 leaves it
// off); the backtick key (`) toggles it, except while typing in a text field.
// It does not reveal the Dev settings tab: those controls are a normal tab
// in the settings drawer. Player-only and client-only: it never sends a room
// command and does not touch the sim.

const CLASS = 'dev-view';

export function devViewFromQuery(search) {
  const v = new URLSearchParams(search || '').get('dev');
  return v === '1' || v === 'true';
}

function typing(t) {
  if (!t || !t.tagName) return false;
  const tag = t.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select' || t.isContentEditable) return true;
  if (tag !== 'input') return false;
  return !['checkbox', 'radio', 'button', 'range', 'submit', 'reset'].includes((t.type || '').toLowerCase());
}

export function setupDevView(doc = document, win = window) {
  const body = doc.body;
  const set = (on) => body.classList.toggle(CLASS, !!on);
  set(devViewFromQuery(win.location && win.location.search));
  win.addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote' && e.key !== '`') return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    set(!body.classList.contains(CLASS));
    win.dispatchEvent(new Event('resize'));
  }, true);
  return { set, get: () => body.classList.contains(CLASS) };
}
