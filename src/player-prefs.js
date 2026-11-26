// Player preferences saved in this browser (UI overhaul PR 3).
//
// Player-panel controls in settings-registry.js are saved to localStorage
// 'fields.playerPrefs' when the user edits them, and restored on the next
// load. Only values that differ from the registry default are kept.
// Preferences are never kept in the page URL: the saved value wins over
// the default, and a query key with a preference id is ignored (old links
// are cleaned by stripPrefsFromUrl). Restoring dispatches input + change
// like a real edit. Reset settings puts the Preferences controls back to
// their defaults and clears this store.
//
// The Dev tab is a separate TOML document (src/dev-prefs.js,
// 'fields.devConfig'). Those settings are control:false and are not saved
// here. A load that still finds the old keys moves them into that document.
import { SETTINGS, prefUrlKeys } from './settings-registry.js';

export const PREFS_KEY = 'fields.playerPrefs';

const PREF_PANELS = new Set(['player']);
// Saved player prefs that are not single registry controls (kept by save()):
// input_map = the Input mapping radios (src/input-map.js).
export const EXTRA_PREF_KEYS = ['input_map'];

export function playerPrefIds() {
  return SETTINGS.filter((s) => s.scope === 'player' && PREF_PANELS.has(s.panel) && s.control !== false).map((s) => s.id);
}

function read(el) {
  if (el.type === 'checkbox') return el.checked;
  return el.value;
}
function differs(el, saved) {
  if (el.type === 'checkbox') return el.checked !== !!saved;
  return String(el.value) !== String(saved);
}
function load(storage = globalThis.localStorage) {
  try { const o = JSON.parse(storage.getItem(PREFS_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}
function store(o, storage = globalThis.localStorage) {
  try {
    if (Object.keys(o).length) storage.setItem(PREFS_KEY, JSON.stringify(o));
    else storage.removeItem(PREFS_KEY);
  } catch { /* no storage */ }
}

// One EXTRA_PREF_KEYS entry in the same saved object (undefined when unset).
export function readPlayerPref(key, storage = globalThis.localStorage) { return load(storage)[key]; }
// value undefined (or null) removes the key.
export function writePlayerPref(key, value, storage = globalThis.localStorage) {
  const o = load(storage);
  if (value === undefined || value === null) delete o[key]; else o[key] = value;
  store(o, storage);
}

export function installPlayerPrefs(doc = document) {
  const controls = playerPrefIds().map((id) => doc.getElementById(id)).filter(Boolean);
  const byId = new Map(controls.map((el) => [el.id, el]));
  const defaults = new Map(controls.map((el) => [el.id, el.type === 'checkbox' ? el.defaultChecked : el.tagName === 'SELECT' ? (Array.from(el.options).find((o) => o.defaultSelected) || el.options[0] || {}).value : el.defaultValue ?? '']));
  const note = doc.getElementById('prefs_saved');
  let restoring = false;
  const save = () => {
    const out = {};
    for (const el of controls) {
      const d = defaults.get(el.id);
      if (el.type === 'checkbox' ? el.checked !== !!d : String(el.value) !== String(d)) out[el.id] = read(el);
    }
    const prev = load();
    for (const k of EXTRA_PREF_KEYS) if (prev[k] !== undefined) out[k] = prev[k];
    store(out);
    if (note) { note.classList.add('flash'); setTimeout(() => note.classList.remove('flash'), 900); }
  };
  // Firefox restores form state on reload (autocomplete="off" in index.html
  // opts out). A checkbox that still came back from the browser goes back to
  // its markup default, so no handler is left out of step with the box.
  for (const el of controls) if (el.type === 'checkbox') el.checked = el.defaultChecked;
  const saved = load();
  const apply = (id, v) => {
    const el = byId.get(id);
    if (!el || !differs(el, v)) return;
    if (el.tagName === 'SELECT' && !Array.from(el.options).some((o) => o.value === String(v))) return;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (err) { console.error(err); }
  };
  restoring = true;
  try {
    for (const [id, v] of Object.entries(saved)) apply(id, v);
  } finally { restoring = false; }
  // Save on the user's own edits only (not on programmatic dispatches).
  const onEdit = (e) => { if (!restoring && e.isTrusted && byId.has(e.target.id)) save(); };
  doc.addEventListener('change', onEdit, true);
  doc.addEventListener('input', onEdit, true);
  // Reset settings: the Preferences pane (#settings) back to its defaults.
  // The player name (Player menu) keeps its field value; its saved copy goes
  // with the rest of the store.
  const reset = doc.getElementById('reset_settings');
  const panel = doc.getElementById('settings');
  if (reset) reset.addEventListener('click', () => {
    restoring = true;
    try {
      for (const el of controls) if (!panel || !panel.contains || panel.contains(el)) apply(el.id, defaults.get(el.id));
    } finally { restoring = false; }
    try { localStorage.removeItem(PREFS_KEY); } catch { /* no storage */ }
  });
  return { save, ids: controls.map((el) => el.id) };
}

// Old links (before preferences left the URL) can still carry preference
// keys (?camera_follow=1, ?ghost=1, ?sticky_autopilot=0, …). They are not
// applied; this drops them from the address bar once on load. Every other
// key (host, map_size, scenario_selector, dev, hud, …) is kept as is.
export function stripPrefsFromUrl(win = globalThis.window) {
  try {
    if (!win || !win.location || !win.history || typeof win.history.replaceState !== 'function') return false;
    const keys = new Set(prefUrlKeys());
    const current = new URLSearchParams(win.location.search || '');
    const next = new URLSearchParams();
    let dropped = false;
    for (const [k, v] of current.entries()) { if (keys.has(k)) dropped = true; else next.append(k, v); }
    if (!dropped) return false;
    const qs = next.toString();
    // pathname keeps the Pages folder (PR previews live under a subfolder).
    win.history.replaceState(win.history.state, '', win.location.pathname + (qs ? '?' + qs : '') + (win.location.hash || ''));
    return true;
  } catch { return false; }
}
