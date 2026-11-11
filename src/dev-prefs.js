// Dev tab TOML editor. Same interaction as the Room tab (controls.js):
// check the document as you type, point at the bad line, Apply only when
// it is valid and different, Revert puts the applied document back, Reset
// fills the defaults and does not apply. Invalid text never changes the
// applied config, the URL, or the sim.
//
// Apply writes this page's visuals immediately and sends autopilotGains
// (the PID and rudder_max_deg as rudderMax).
// The command is sent first. If the sim or the server rejects it, the
// visuals stay as they were. See src/dev-config.js for which boats get
// the gains in local, worker and remote modes.
import { PREFS_KEY } from './player-prefs.js';
import { STICKY_AUTOPILOT_KEY, setStickyAutopilot } from './controls.js';
import {
  DEV_CONFIG_DEFAULTS,
  DEV_CONFIG_KEY,
  DEV_CONFIG_KEYS,
  DEV_TOML_FIELDS,
  devBoatCommand,
  configFromQuery,
  configFromStored,
  devClientEffects,
  devConfigErrorLine,
  devConfigIds,
  legacyUrlValue,
  parseAndValidateDevConfig,
  stringifyDevConfig,
} from './dev-config.js';

function readJson(storage, key) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  if (!storage) return;
  try {
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch { /* no storage */ }
}

function stripLegacy(storage) {
  if (!storage) return;
  const prefs = readJson(storage, PREFS_KEY);
  if (prefs) {
    let changed = false;
    for (const id of devConfigIds()) if (id in prefs) { delete prefs[id]; changed = true; }
    if (changed) writeJson(storage, PREFS_KEY, Object.keys(prefs).length ? prefs : null);
  }
  try { storage.removeItem(STICKY_AUTOPILOT_KEY); } catch { /* no storage */ }
}

function searchParams() {
  try { return new URLSearchParams((globalThis.location && globalThis.location.search) || ''); }
  catch { return new URLSearchParams(); }
}

function replaceQuery(params) {
  const hist = globalThis.history;
  const loc = globalThis.location;
  if (!hist || !loc || typeof hist.replaceState !== 'function') return;
  const qs = params.toString();
  const next = loc.pathname + (qs ? '?' + qs : '') + (loc.hash || '');
  const current = loc.pathname + loc.search + (loc.hash || '');
  if (next === current) return;
  hist.replaceState(hist.state, '', next);
}

const ID_TO_KEY = new Map(DEV_TOML_FIELDS.map((f) => [f.id, f.key]));
function idToKey(id) { return ID_TO_KEY.get(id); }

function syncDevUrl(cfg) {
  const current = searchParams();
  const ids = new Set(devConfigIds());
  const next = new URLSearchParams();
  for (const [key, value] of current.entries()) if (!ids.has(key)) next.append(key, value);
  for (const id of devConfigIds()) {
    const value = legacyUrlValue(id, cfg[idToKey(id)]);
    if (value != null) next.append(id, value);
  }
  replaceQuery(next);
}

function isDefaultConfig(cfg) {
  return DEV_CONFIG_KEYS.every((k) => cfg[k] === DEV_CONFIG_DEFAULTS[k]);
}

/**
 * Install the Dev TOML editor.
 * applyLocal(effects) updates this page (view, tracers, trails, ghost,
 * sticky autopilot, perf, plot). It must not touch another client's boat.
 * Returns { ready } — the startup apply (saved + query).
 */
export function installDevPrefs(doc, { host, applyLocal, storage } = {}) {
  const root = doc || document;
  const store = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  const ta = root.getElementById('dev_config');
  if (!ta || !host) return { ready: Promise.resolve(null) };

  const saved = readJson(store, DEV_CONFIG_KEY);
  const legacy = readJson(store, PREFS_KEY);
  let stickyRaw = null;
  try { stickyRaw = store ? store.getItem(STICKY_AUTOPILOT_KEY) : null; } catch { stickyRaw = null; }
  const stored = configFromStored(saved, legacy, stickyRaw);
  if (stored.migrated && !isDefaultConfig(stored.config)) writeJson(store, DEV_CONFIG_KEY, stored.config);
  if (stored.migrated || legacy || stickyRaw != null) stripLegacy(store);

  let applied = configFromQuery(stored.config, searchParams());
  let dirty = false;
  let pidPending = false;
  let gen = 0;

  const checkEl = () => root.getElementById('dev_config_check');
  const statusEl = () => root.getElementById('dev_config_status');
  const modeEl = () => root.getElementById('dev_config_mode');

  function appliedText() { return stringifyDevConfig(applied); }

  function showStatus(msg) {
    const el = statusEl();
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function refresh() {
    const text = ta.value;
    const changed = text !== appliedText();
    const v = parseAndValidateDevConfig(text);
    const line = v.error ? devConfigErrorLine(text, v) : null;
    const check = checkEl();
    if (check) {
      check.classList.toggle('bad', !!v.error);
      check.dataset.line = line || '';
      const pending = !v.error && !changed && pidPending ? ' · autopilot PID waits for your boat' : '';
      check.textContent = v.error ? (line ? `Line ${line}: ` : '') + v.error
        : changed ? 'Valid · not applied yet' : 'Valid · matches this page' + pending;
    }
    const mode = modeEl();
    if (mode) mode.textContent = 'This page';
    ta.classList.toggle('bad', !!v.error);
    const commit = root.getElementById('dev_config_commit');
    if (commit) commit.disabled = !!v.error || !changed;
    const revert = root.getElementById('dev_config_revert');
    if (revert) revert.disabled = !changed;
  }

  function fill(cfg) {
    ta.value = stringifyDevConfig(cfg);
    dirty = false;
    refresh();
  }

  async function commit(text, { fromUser } = {}) {
    const my = ++gen;
    const parsed = parseAndValidateDevConfig(text);
    if (parsed.error) { refresh(); return parsed; }
    const gains = devBoatCommand(parsed.config);
    let r;
    try {
      // LocalHost applies inside commandSync, before the first frame.
      // Worker and remote resolve when the host accepts the gains.
      if (host.commandSync && host.kind !== 'remote') r = host.commandSync(gains);
      else r = await host.command(gains);
    } catch (e) {
      if (my !== gen) return { stale: true };
      showStatus('Rejected: ' + (e && e.message ? e.message : String(e)));
      refresh();
      return { error: e && e.message ? e.message : String(e) };
    }
    if (my !== gen) return { stale: true };
    if (r && r.error) {
      showStatus('Rejected: ' + r.error);
      refresh();
      return r;
    }
    applied = parsed.config;
    pidPending = !!(r && r.pending);
    if (applyLocal) applyLocal(devClientEffects(applied));
    if (fromUser) writeJson(store, DEV_CONFIG_KEY, isDefaultConfig(applied) ? null : applied);
    syncDevUrl(applied);
    showStatus(null);
    if (ta.value === text) fill(applied);
    else { dirty = true; refresh(); }
    return r || { ok: true };
  }

  ta.addEventListener('input', () => { dirty = true; showStatus(null); refresh(); });
  const check = checkEl();
  if (check) check.addEventListener('click', () => {
    const n = parseInt(check.dataset.line, 10);
    if (!n) return;
    const lines = ta.value.split('\n');
    const start = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus();
    if (ta.setSelectionRange) ta.setSelectionRange(start, start + (lines[n - 1] || '').length);
    const lh = typeof getComputedStyle === 'function' ? (parseFloat(getComputedStyle(ta).lineHeight) || 16) : 16;
    ta.scrollTop = Math.max(0, (n - 3) * lh);
  });
  const revertBtn = root.getElementById('dev_config_revert');
  if (revertBtn) revertBtn.addEventListener('click', () => { fill(applied); showStatus(null); });
  const resetBtn = root.getElementById('dev_config_reset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    ta.value = stringifyDevConfig(DEV_CONFIG_DEFAULTS);
    dirty = true;
    showStatus(null);
    refresh();
  });
  const commitBtn = root.getElementById('dev_config_commit');
  if (commitBtn) commitBtn.addEventListener('click', () => {
    const text = ta.value;
    const parsed = parseAndValidateDevConfig(text);
    if (parsed.error) { refresh(); return; }
    commitBtn.disabled = true;
    commit(text, { fromUser: true }).then(() => refresh());
  });

  if (host.on) host.on((ev) => {
    if (!ev || ev.type !== 'ownBoats') return;
    const boats = ev.boats || [];
    if (!boats.length) { pidPending = true; refresh(); return; }
    commit(stringifyDevConfig(applied)).then((r) => {
      if (r && r.boats && r.boats.length) pidPending = false;
      refresh();
    });
  });

  fill(applied);
  const ready = commit(ta.value).then((r) => { refresh(); return r; });
  return { ready, dirty: () => dirty };
}

/** Apply a validated config's client effects. main.js passes the real view and renderer. */
export function applyDevEffects(effects, { view, host, setTracerParams, setBoatTrailsOn, setTrailParams, setGhostParams, setPerfOverlayOn } = {}) {
  if (!effects) return;
  if (setTracerParams) setTracerParams({ count: effects.tracerCount, lifetime: effects.tracerLife, tail: effects.tracerTail });
  if (setBoatTrailsOn) setBoatTrailsOn(effects.boatTrails);
  if (setTrailParams) setTrailParams({ interval: effects.trailInterval, duration: effects.trailDuration, size: effects.trailSize });
  if (setGhostParams) setGhostParams({ on: effects.ghost, ahead: effects.ghostAhead });
  setStickyAutopilot(effects.stickyAutopilot);
  if (view) {
    if (view.input_show_fields) view.input_show_fields(effects.flowTracers);
    if (view.input_show_forces) view.input_show_forces(effects.showForces);
    if (view.input_show_refinement) view.input_show_refinement(effects.showRefinement);
  }
  if (host && host.setFlow) host.setFlow(effects.flowTracers);
  if (host && host.setPerf) host.setPerf(effects.perf);
  if (setPerfOverlayOn) setPerfOverlayOn(effects.perf);
  if (host && host.command) host.command({ type: 'plot', plotType: effects.plotType, contrastExp: effects.contrastExp });
}
