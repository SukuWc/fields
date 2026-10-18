// Largest absolute difference between two built scenes (scene-build.js
// buildScene output, or any plain data): Infinity when their shape differs
// (keys, lengths, types, strings). Body ids are skipped: they are opaque
// fixture ids from a per-process counter, so two hosts in one process differ.
export function sceneDiff(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : Math.abs(a - b);
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return Infinity;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    let d = 0;
    for (const k of keys) {
      if (k === 'id' || (a[k] === undefined && b[k] === undefined)) continue;
      d = Math.max(d, sceneDiff(a[k], b[k]));
      if (d === Infinity) return d;
    }
    return d;
  }
  return a === b ? 0 : Infinity;
}
