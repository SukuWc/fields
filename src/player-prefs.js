// Player preferences saved in this browser (UI overhaul PR 3).
//
// Every player-scope control in settings-registry.js (panel 'player') is
// saved to localStorage 'fields.playerPrefs' when the user edits it, and
// restored on the next load. Only values that differ from the registry
// default are kept. Precedence on load: a query key (?ghost=1) wins over the
// saved value, which wins over the default. Restoring dispatches input +
// change like a real edit, so the existing listeners (and url-settings.js)
// see it. Reset settings clears the saved values.
//
// Not here: sticky_autopilot (controls.js has its own key) and settings with
// control:false. Client-only: nothing is sent to the server except through
// the controls' own listeners (e.g. the per-client subscriptions).
import { SETTINGS } from './settings-registry.js';

export const PREFS_KEY = 'fields.playerPrefs';
const SKIP = new Set(['sticky_autopilot']);

export function playerPrefIds() {
  return SETTINGS.filter((s) => s.scope === 'player' && s.panel === 'player' && s.control !== false && !SKIP.has(s.id)).map((s) => s.id);
}

function read(el) {
  if (el.type === 'checkbox') return el.checked;
  return el.value;
}
function differs(el, saved) {
  if (el.type === 'checkbox') return el.checked !== !!saved;
  return String(el.value) !== String(saved);
}
function load() {
  try { const o = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
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
    try {
      if (Object.keys(out).length) localStorage.setItem(PREFS_KEY, JSON.stringify(out));
      else localStorage.removeItem(PREFS_KEY);
    } catch { /* no storage */ }
    if (note) { note.classList.add('flash'); setTimeout(() => note.classList.remove('flash'), 900); }
  };
  // Restore: skip keys the URL sets (url-settings.js already applied them).
  const params = new URLSearchParams(window.location.search);
  const saved = load();
  restoring = true;
  try {
    for (const [id, v] of Object.entries(saved)) {
      const el = byId.get(id);
      if (!el || params.has(id) || !differs(el, v)) continue;
      if (el.tagName === 'SELECT' && !Array.from(el.options).some((o) => o.value === String(v))) continue;
      if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
      try {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (err) { console.error(err); }
    }
  } finally { restoring = false; }
  // Save on the user's own edits only (not on programmatic dispatches).
  const onEdit = (e) => { if (!restoring && e.isTrusted && byId.has(e.target.id)) save(); };
  doc.addEventListener('change', onEdit, true);
  doc.addEventListener('input', onEdit, true);
  const reset = doc.getElementById('reset_settings');
  if (reset) reset.addEventListener('click', () => { try { localStorage.removeItem(PREFS_KEY); } catch { /* no storage */ } });
  return { save, ids: controls.map((el) => el.id) };
}
