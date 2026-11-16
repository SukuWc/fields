// Settings → Player → Input mapping: one radio row per input device
// (Keyboard: Split / Boat 1 / Boat 2; Gamepad 1 and 2: Boat 1 / Boat 2).
// The routing itself is controls.js (setInputMap, keyBindings, setPadAction);
// this module only wires the radios, the gamepad status and persistence.
//
// Saved with the other player prefs ('fields.playerPrefs', key input_map,
// only when it differs from the default); Reset settings returns to the
// defaults (Split, pad 1 → boat 1, pad 2 → boat 2 = the behaviour before the
// mapping existed). The radios are always editable: with one boat bound every
// device still drives it (a hint says the mapping applies with two boats),
// and the saved choice takes effect once a second boat is bound.
//
// The radios have no ids on purpose: they are not registry controls
// (settings-registry.js), so url-settings.js and the registry checks skip them.
import { setInputMap, inputMap, normalizeInputMap, DEFAULT_INPUT_MAP, onBindingChange, boundBoats, MAX_PADS } from './controls.js';
import { readPlayerPref, writePlayerPref } from './player-prefs.js';

export const INPUT_MAP_PREF = 'input_map';
const NAMES = { keyboard: 'input_map_keyboard', pads: Array.from({ length: MAX_PADS }, (_, i) => 'input_map_pad' + (i + 1)) };

// The saved value: only what differs from the default, or undefined.
export function inputMapPref(m) {
  const n = normalizeInputMap(m);
  const out = {};
  if (n.keyboard !== DEFAULT_INPUT_MAP.keyboard) out.keyboard = n.keyboard;
  if (n.pads.some((p, i) => p !== DEFAULT_INPUT_MAP.pads[i])) out.pads = n.pads;
  return Object.keys(out).length ? out : undefined;
}

export function setupInputMap(doc = document, storage = globalThis.localStorage) {
  const group = doc.getElementById('input_map_group');
  if (!group) return null;
  const radios = (name) => Array.from(group.querySelectorAll('input[type="radio"][name="' + name + '"]'));

  function show(m) {
    for (const r of radios(NAMES.keyboard)) r.checked = r.value === m.keyboard;
    NAMES.pads.forEach((name, i) => { for (const r of radios(name)) r.checked = r.value === m.pads[i]; });
  }
  function read() {
    const pick = (name) => { const r = radios(name).find((x) => x.checked); return r ? r.value : undefined; };
    return normalizeInputMap({ keyboard: pick(NAMES.keyboard), pads: NAMES.pads.map(pick) });
  }
  function apply(m, save) {
    setInputMap(m);
    show(inputMap());
    if (save) writePlayerPref(INPUT_MAP_PREF, inputMapPref(inputMap()), storage);
  }
  // The radios stay editable with any number of boats; with fewer than two
  // the choice is saved but every device drives the one boat, so a hint says
  // when it applies.
  function syncHint(boats) {
    const single = !(boats > 1);
    group.classList.toggle('single', single);
    const hint = doc.getElementById('input_map_hint');
    if (hint) hint.hidden = !single;
  }
  function syncPads() {
    const nav = globalThis.navigator;
    const list = nav && nav.getGamepads ? Array.from(nav.getGamepads() || []).filter((p) => p && p.connected) : [];
    for (const el of group.querySelectorAll('[data-pad-status]')) {
      const p = list[Number(el.dataset.padStatus)];
      el.textContent = p ? '(connected)' : '(not connected)';
    }
  }

  apply(readPlayerPref(INPUT_MAP_PREF, storage), false);
  group.addEventListener('change', (e) => {
    if (e.target && e.target.type === 'radio') apply(read(), true);
  });
  const reset = doc.getElementById('reset_settings');
  if (reset) reset.addEventListener('click', () => apply(DEFAULT_INPUT_MAP, false));
  onBindingChange(syncHint);
  syncHint(boundBoats());
  syncPads();
  if (globalThis.addEventListener) {
    globalThis.addEventListener('gamepadconnected', syncPads);
    globalThis.addEventListener('gamepaddisconnected', syncPads);
  }
  return { apply, read };
}
