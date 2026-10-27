// Settings panel from the registry (settings-registry.js): each *control*
// (player panel) gets its default and number range from there, not from the
// markup. Room settings have control:false — the admin panel is a TOML
// textarea (room-config.js), not per-setting inputs.
import { SETTINGS } from './settings-registry.js';

export const PANEL_IDS = { player: 'player_panel', room: 'admin_panel' };

// Before anything reads a control (url-settings.js captures these as the
// defaults). Returns the mismatches found (also logged). Skips settings
// with control:false (no DOM).
export function applySettingDefaults(doc = document) {
  const problems = [];
  for (const s of SETTINGS) {
    if (s.control === false) continue;
    const el = doc.getElementById(s.id);
    if (!el) { problems.push(s.id + ': no control'); continue; }
    if (!el.closest('#' + PANEL_IDS[s.panel])) problems.push(s.id + ': not in #' + PANEL_IDS[s.panel]);
    const d = s.default;
    if (el.type === 'checkbox') {
      el.defaultChecked = !!d;
      el.checked = !!d;
      continue;
    }
    if (el.tagName === 'SELECT') {
      for (const o of el.options) o.defaultSelected = o.value === String(d);
      if (s.markDefault) for (const o of el.options) if (o.value === String(d) && !/\bdefault\b/.test(o.textContent)) o.textContent = /\)$/.test(o.textContent) ? o.textContent.replace(/\(([^()]*)\)$/, '(default, $1)') : o.textContent + ' (default)';
      el.value = String(d);
      continue;
    }
    if (el.type === 'number' || el.type === 'range') {
      // Range first: a range input clamps its value to min..max.
      const ui = s.ui || {};
      const min = 'min' in ui ? ui.min : s.min;
      const max = 'max' in ui ? ui.max : s.max;
      if (min !== undefined && min !== null) el.min = String(min);
      if (max !== undefined && max !== null) el.max = String(max);
    }
    const v = d === null || d === undefined ? '' : String(d);
    el.defaultValue = v;
    el.value = v;
  }
  if (problems.length) console.warn('settings panel does not match the registry: ' + problems.join('; '));
  return problems;
}
