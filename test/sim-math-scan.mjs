// Source scanner for the deterministic-math guard (test/det-math-guard.test.mjs):
// built-in transcendental Math calls and ** with an exponent other than a
// literal 2, outside comments and string literals.
export const TRANSCENDENTAL = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'hypot', 'cbrt'];

// Comments and string / template literal contents → spaces (newlines kept,
// so offsets and line numbers stay valid).
export function stripCode(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      const e = j < 0 ? n : j;
      out += blank(src.slice(i, e)); i = e;
    } else if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      const e = j < 0 ? n : j + 2;
      out += blank(src.slice(i, e)); i = e;
    } else if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += c + blank(src.slice(i + 1, j)) + (j < n ? c : ''); i = j + 1;
    } else {
      out += c; i++;
    }
  }
  return out;
}

// [{ line, text, kind }] for every offending use in src.
export function scanSimMath(src) {
  const code = stripCode(src);
  const lines = src.split('\n');
  const found = [];
  const lineOf = (k) => code.slice(0, k).split('\n').length;
  const callRe = new RegExp('(?<![\\w.$])Math\\.(' + TRANSCENDENTAL.join('|') + ')\\b', 'g');
  for (const m of code.matchAll(callRe)) {
    const line = lineOf(m.index);
    found.push({ line, kind: 'Math.' + m[1], text: lines[line - 1].trim() });
  }
  for (const m of code.matchAll(/\*\*(?!=)\s*([^\s;,)\]}]*)/g)) {
    if (m[1] === '2') continue;
    const line = lineOf(m.index);
    found.push({ line, kind: '** ' + m[1], text: lines[line - 1].trim() });
  }
  return found;
}
