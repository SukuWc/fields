// Dual-layer TOML highlighting for the Dev and Room editors: a <pre> behind
// a transparent textarea paints each key = value line red when that value
// differs from the default. Editing, scroll, Apply / Revert / Reset and
// validation stay on the textarea; this module only paints.
//
// Defaults come from the caller (DEV_CONFIG_DEFAULTS, or defaultRoomConfig
// with the room's map size). Nested tables ([wind_dir], [custom.marks], …)
// use dotted paths. Multi-line arrays (legs = [ … ]) colour the whole block.
import { parse as parseToml } from 'smol-toml';

const NONDEFAULT_CLASS = 'toml-nondefault';

/** Deep equality for TOML values (numbers within 1e-9 relative). */
export function tomlValuesEqual(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!tomlValuesEqual(a[i], b[i])) return false;
    return true;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!tomlValuesEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function getAt(obj, path) {
  let cur = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Leaf dotted paths whose value in `config` differs from `defaults`.
 * Objects recurse; arrays and scalars are leaves.
 */
export function collectNonDefaultPaths(config, defaults) {
  const out = new Set();
  // Only paths that exist under defaults. Ignored / legacy keys (e.g. room
  // ladder_lines) are skipped so they never look like a deliberate override.
  function walk(a, b, prefix) {
    if (b === undefined) return;
    if (tomlValuesEqual(a, b)) return;
    const bothObjects = a && b
      && typeof a === 'object' && typeof b === 'object'
      && !Array.isArray(a) && !Array.isArray(b);
    if (bothObjects) {
      for (const k of Object.keys(b)) walk(a ? a[k] : undefined, b[k], prefix ? prefix + '.' + k : k);
      return;
    }
    if (prefix) out.add(prefix);
  }
  walk(config, defaults, '');
  return out;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bracketDelta(s) {
  let d = 0;
  let inStr = false;
  let strCh = '';
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === '[' || c === '{') d++;
    else if (c === ']' || c === '}') d--;
  }
  return d;
}

function tryParseRhs(rhs) {
  try {
    const raw = parseToml('__v = ' + rhs);
    return { ok: true, value: raw.__v };
  } catch {
    return { ok: false };
  }
}

/**
 * Build the highlighted HTML for the backdrop <pre>.
 * When `config` is a validated parse of `text`, paths come from a full
 * config-vs-defaults diff. Otherwise each complete assignment is compared
 * on its own (best effort while the document is invalid).
 */
export function highlightTomlHtml(text, defaults, config) {
  const src = String(text ?? '');
  const lines = src.split('\n');
  const paths = (config && defaults) ? collectNonDefaultPaths(config, defaults) : null;

  const out = [];
  let table = [];
  let depth = 0;
  let colourBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '' || trimmed.startsWith('#')) {
      if (depth <= 0) colourBlock = false;
      out.push(colourBlock && depth > 0
        ? `<span class="${NONDEFAULT_CLASS}">${escapeHtml(line)}</span>`
        : escapeHtml(line));
      continue;
    }

    const tableMatch = /^\[\s*([^\]]+?)\s*\]$/.exec(trimmed);
    if (tableMatch && !trimmed.startsWith('[[')) {
      table = tableMatch[1].split('.').map((p) => p.trim()).filter(Boolean);
      depth = 0;
      colourBlock = false;
      out.push(escapeHtml(line));
      continue;
    }

    const assign = /^(\s*)([A-Za-z_][\w-]*)\s*=\s*(.*)$/.exec(line);
    if (assign) {
      const key = assign[2];
      const rhs = assign[3];
      const pathArr = [...table, key];
      const path = pathArr.join('.');
      let isNon = false;
      const open = bracketDelta(rhs);

      if (paths) {
        isNon = paths.has(path);
      } else if (defaults) {
        const def = getAt(defaults, pathArr);
        if (def !== undefined) {
          if (open > 0) {
            let block = rhs;
            let d = open;
            let j = i;
            while (d > 0 && j + 1 < lines.length) {
              j++;
              block += '\n' + lines[j];
              d += bracketDelta(lines[j]);
            }
            const full = tryParseRhs(block);
            if (full.ok) isNon = !tomlValuesEqual(full.value, def);
          } else {
            const parsed = tryParseRhs(rhs);
            if (parsed.ok) isNon = !tomlValuesEqual(parsed.value, def);
          }
        }
      }

      colourBlock = isNon && open > 0;
      depth = open > 0 ? open : 0;
      out.push(isNon
        ? `<span class="${NONDEFAULT_CLASS}">${escapeHtml(line)}</span>`
        : escapeHtml(line));
      if (open <= 0) colourBlock = false;
      continue;
    }

    if (colourBlock && depth > 0) {
      out.push(`<span class="${NONDEFAULT_CLASS}">${escapeHtml(line)}</span>`);
      depth += bracketDelta(line);
      if (depth <= 0) { depth = 0; colourBlock = false; }
      continue;
    }
    depth = Math.max(0, depth + bracketDelta(line));
    out.push(escapeHtml(line));
  }
  return out.join('\n');
}

/**
 * Wrap a textarea in the dual-layer editor (idempotent) and keep the
 * backdrop in sync. Call `refresh()` after any programmatic value change
 * (fill / Reset / Revert). `getDefaults()` returns the defaults object;
 * `getConfig(text)` may return a validated config or null.
 */
export function installTomlHighlight(ta, { getDefaults, getConfig } = {}) {
  if (!ta || !ta.parentNode) return { refresh() {}, destroy() {} };

  let wrap = ta.closest('.toml-editor');
  let pre;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toml-editor';
    ta.parentNode.insertBefore(wrap, ta);
    wrap.appendChild(ta);
  }
  pre = wrap.querySelector('.toml-highlight');
  if (!pre) {
    pre = document.createElement('pre');
    pre.className = 'toml-highlight';
    pre.setAttribute('aria-hidden', 'true');
    wrap.insertBefore(pre, ta);
  }
  if (!ta.classList.contains('toml-box')) ta.classList.add('toml-box');
  ta.classList.add('toml-box-overlay');

  function paint() {
    const text = ta.value;
    const defaults = typeof getDefaults === 'function' ? getDefaults() : getDefaults;
    let config = null;
    if (typeof getConfig === 'function') {
      try { config = getConfig(text); } catch { config = null; }
    }
    pre.innerHTML = highlightTomlHtml(text, defaults, config);
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  function onScroll() {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', onScroll);
  paint();
  return {
    refresh: paint,
    destroy() {
      ta.removeEventListener('input', paint);
      ta.removeEventListener('scroll', onScroll);
    },
  };
}
