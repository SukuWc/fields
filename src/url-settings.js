// Keep the #settings controls and the page query string in sync.
//
// Defaults are whatever the controls hold when this runs, so JS that adjusts
// the initial HTML (the wind inputs) is the default — not the raw markup.
// show_forces stays unchecked, matching the HTML and Map. Only values that
// differ from those defaults are written. Unknown
// query keys are left alone. `devmode=1` (also `true`) is the existing link
// for the dev-mode checkbox; we still write it as `devmode=1` and omit it
// when the box is off.

const SKIP_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "image",
  "file",
  "hidden",
]);

const CHECKED_VALUES = new Set(["1", "true", "on", "yes"]);
const UNCHECKED_VALUES = new Set(["0", "false", "off", "no"]);

function isSettingsControl(el) {
  if (!el || !el.id) return false;
  if (el.tagName === "SELECT" || el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  return !SKIP_INPUT_TYPES.has(el.type);
}

function readControl(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number" || el.type === "range") return readNumber(el.value);
  return el.value;
}

function readNumber(raw) {
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function same(el, a, b) {
  if (el.type === "checkbox") return !!a === !!b;
  if (el.type === "number" || el.type === "range") {
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
  }
  return String(a) === String(b);
}

function serialize(el, value) {
  if (el.type === "checkbox") return value ? "1" : "0";
  if (el.type === "number" || el.type === "range") return String(value);
  return String(value);
}

// undefined means "ignore this param". null is not used for checkboxes.
function parseQueryValue(el, raw) {
  if (raw == null) return undefined;
  if (el.type === "checkbox") {
    const token = String(raw).trim().toLowerCase();
    if (CHECKED_VALUES.has(token)) return true;
    if (UNCHECKED_VALUES.has(token)) return false;
    return undefined;
  }
  if (el.tagName === "SELECT") {
    const match = Array.from(el.options).some((option) => option.value === raw);
    return match ? raw : undefined;
  }
  if (el.type === "number" || el.type === "range") {
    // Any finite number. Min/max are spinner hints; a typed value outside them
    // still has to round-trip, because the existing change handlers accept it.
    const n = readNumber(raw);
    return n == null ? undefined : n;
  }
  return String(raw);
}

function writeControl(el, value) {
  if (el.type === "checkbox") {
    el.checked = !!value;
    return;
  }
  el.value = value == null ? "" : String(value);
}

function dispatchControl(el) {
  // input then change matches a real edit. Inline handlers (the legacy
  // resetTimer() on the animation controls) can throw; the value is already
  // on the element, and one bad handler must not skip the rest.
  try {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } catch (err) {
    console.error(err);
  }
}

function replaceQuery(params) {
  const qs = params.toString();
  // pathname already includes the Pages folder (/fields/, or a PR preview
  // under /fields/pr-preview/pr-<N>/). Replacing only the query keeps that
  // prefix; an absolute "/" would drop the app out of its subfolder.
  const next = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (next === current) return;
  window.history.replaceState(window.history.state, "", next);
}

export function installUrlSettings(root) {
  const panel = root || document.getElementById("settings");
  if (!panel || !window.history || typeof window.history.replaceState !== "function") return;

  // The animation sliders call resetTimer() from an inline handler. That
  // function is not defined; a real edit already throws. Define a no-op so
  // applying the query string or resetting those controls does not throw.
  if (typeof window.resetTimer !== "function") {
    window.resetTimer = function resetTimer() {};
  }

  const controls = Array.from(panel.querySelectorAll("input, select, textarea")).filter(isSettingsControl);
  const defaults = new Map(controls.map((el) => [el.id, readControl(el)]));
  let writing = false;

  function syncUrl() {
    const current = new URLSearchParams(window.location.search);
    const known = new Set(controls.map((el) => el.id));
    const desired = new Map();
    for (const el of controls) {
      const value = readControl(el);
      const initial = defaults.get(el.id);
      if (value == null || same(el, value, initial)) continue;
      desired.set(el.id, serialize(el, value));
    }

    // Keep unrelated keys, and keep each setting key in its current slot.
    // Settings that were just changed are appended after those.
    const next = new URLSearchParams();
    const seen = new Set();
    for (const [key, value] of current.entries()) {
      if (!known.has(key)) {
        next.append(key, value);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      if (desired.has(key)) next.append(key, desired.get(key));
    }
    for (const [key, value] of desired) {
      if (!seen.has(key)) next.append(key, value);
    }
    replaceQuery(next);
  }

  function applyValues(valuesById) {
    writing = true;
    try {
      for (const el of controls) {
        if (!valuesById.has(el.id)) continue;
        const next = valuesById.get(el.id);
        if (next === undefined || same(el, readControl(el), next)) continue;
        writeControl(el, next);
        dispatchControl(el);
      }
    } finally {
      writing = false;
    }
  }

  function applyQuery() {
    const params = new URLSearchParams(window.location.search);
    const updates = new Map();
    for (const el of controls) {
      if (!params.has(el.id)) continue;
      const parsed = parseQueryValue(el, params.get(el.id));
      if (parsed === undefined) continue;
      updates.set(el.id, parsed);
    }
    applyValues(updates);
  }

  function onEdit(event) {
    if (writing) return;
    if (!controls.includes(event.target)) return;
    syncUrl();
  }

  panel.addEventListener("input", onEdit);
  panel.addEventListener("change", onEdit);

  const resetButton = document.getElementById("reset_settings");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      applyValues(defaults);
      syncUrl();
    });
  }

  applyQuery();
  syncUrl();
}
