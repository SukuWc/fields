// Settings drawer tabs (UI overhaul PR 3): one pane, two tabs.
//   Player  #player_panel  this page's preferences (player-prefs.js saves them)
//   Room    #admin_panel   the room's TOML settings (room-config.js / controls.js)
// The active tab is #settings[data-tab]; CSS hides the other pane. The last
// tab is remembered in this browser (localStorage 'fields.settingsTab').
const STORE_KEY = 'fields.settingsTab';
const TABS = ['player', 'room'];

export function setupSettingsTabs(doc = document) {
  const root = doc.getElementById('settings');
  const bar = doc.getElementById('settings_tabs');
  if (!root || !bar) return null;
  const buttons = Array.from(bar.querySelectorAll('[data-tab]'));
  const select = (tab, remember) => {
    if (!TABS.includes(tab)) tab = 'player';
    root.dataset.tab = tab;
    for (const b of buttons) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
    if (remember) { try { localStorage.setItem(STORE_KEY, tab); } catch { /* no storage */ } }
  };
  for (const b of buttons) b.addEventListener('click', () => select(b.dataset.tab, true));
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    const i = TABS.indexOf(root.dataset.tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    select(next, true);
    const btn = buttons.find((b) => b.dataset.tab === next);
    if (btn) btn.focus();
  });
  let stored = null;
  try { stored = localStorage.getItem(STORE_KEY); } catch { /* no storage */ }
  select(stored || 'player', false);
  return { select };
}
