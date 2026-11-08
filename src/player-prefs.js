// Player preferences saved in this browser (UI overhaul PR 3).
//
// Player-panel controls in settings-registry.js are saved to localStorage
// 'fields.playerPrefs' when the user edits them, and restored on the next
// load. Only values that differ from the registry default are kept.
// Precedence on load: a query key wins over the saved value, which wins
// over the default. Restoring dispatches input + change like a real edit.
// Reset settings clears this store.
//
// The Dev tab is a separate TOML document (src/dev-prefs.js,
// 'fields.devConfig'). Those settings are control:false and are not saved
// here. A load that still finds the old keys moves them into that document.
import { SETTINGS } from './settings-registry.js';

export const PREFS_KEY = 'fields.playerPrefs';

const PREF_PANELS = new Set(['player']);

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
