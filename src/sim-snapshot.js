// Sim snapshots (replay seeking, docs/replay-determinism.md): a deep copy of
// a running SimCore's state that, restored, steps on bit for bit like the
// original (test/sim-snapshot.test.mjs checks the recorded hashes after a
// restore, in Node and, via scripts/determinism/browsers.mjs, in Chromium,
// Firefox and WebKit). In memory only: a snapshot is the engine's own object
// graph, not a file format, so it is valid for the build that made it.
//
// The copy keeps prototypes, shared references and cycles, typed arrays,
// Map and Set, own non-enumerable fields and key order (the state hash walks
// fields in insertion order). It never looks at constructor or function
// names: esbuild renames them in the browser bundle (World → World2).
//
// What the copy cannot see, and how the sim keeps it visible:
//   - random generator state: gusts.js Mulberry32 keeps it on a plain object;
//   - per-boat / per-lattice side tables: on the owners as non-enumerable
//     fields (boat._speedAcc wind.js, boat._amrDomain and bm._trackState
//     domainTrack.js, boat._ruleId rules.js), not in module-level WeakMaps;
//   - WeakMaps are not iterable: none in the sim state (course progress is
//     a Map); a WeakMap met here is shared, not copied;
//   - functions are shared by reference. planck-js binds two of its own
//     (World.addPair, BroadPhase.queryCallback) and keeps a node free list
//     in a closure (DynamicTree.m_pool); those are rebuilt on the copy
//     (planckFixups). Sim listeners and scenario scripts are shared; they
//     take the sim as an argument or reach it through the host.
const TypedArray = Object.getPrototypeOf(Int8Array);

function isWeak(v) {
  const tag = Object.prototype.toString.call(v);
  return tag === '[object WeakMap]' || tag === '[object WeakSet]' || tag === '[object WeakRef]';
}

// Field copiers, one per (prototype, key list), compiled once: named stores
// keep a copy in fast-properties mode. Filling an empty object through
// computed keys (c[k] = ...) turned every copied lattice cell into a
// dictionary-mode object, and the sim ran about five times slower on the
// copies (and slower on fresh cores too, its property accesses gone
// megamorphic). Wide or one-off key sets (dictionary-like objects) are
// copied the plain way.
const COPIER_MAX_KEYS = 64;
const COPIERS_PER_PROTO = 64;
const copiers = new Map();
const plainCopy = (v, keys, proto) => {
  const c = proto === Object.prototype ? {} : Object.create(proto);
  for (let i = 0; i < keys.length; i++) c[keys[i]] = v[keys[i]];
  return c;
};

function copierFor(proto, keys) {
  if (keys.length > COPIER_MAX_KEYS) return plainCopy;
  let byKeys = copiers.get(proto);
  if (!byKeys) { byKeys = new Map(); copiers.set(proto, byKeys); }
  const id = keys.join('\u0000');
  let f = byKeys.get(id);
  if (f) return f;
  if (byKeys.size >= COPIERS_PER_PROTO) return plainCopy;
  const body = ['const c = P === OP ? {} : Object.create(P);'];
  for (const k of keys) body.push(`c[${JSON.stringify(k)}] = v[${JSON.stringify(k)}];`);
  body.push('return c;');
  const g = new Function('v', 'P', 'OP', body.join('\n'));
  f = (v, _keys, p) => g(v, p, Object.prototype);
  byKeys.set(id, f);
  return f;
}

/**
 * Deep copy of `root`. keep: objects to share, not copy (the field painter,
 * the texture). seen: old → copy (pass one to copy several roots together).
 *
 * Three passes: (1) find every reachable object; (2) copy each one's fields
 * as they are (references still to the originals) with a compiled copier;
 * (3) swap those references for the copies in place (no new properties, so
 * no hidden-class changes).
 */
export function deepCopy(root, { keep = null, seen = new Map() } = {}) {
  const found = [];
  const visit = (v) => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    if ((keep && keep.has(v)) || isWeak(v)) { seen.set(v, v); return; }
    if (v instanceof TypedArray) { seen.set(v, v.slice()); return; }
    if (v instanceof ArrayBuffer) { seen.set(v, v.slice(0)); return; }
    seen.set(v, null);
    found.push(v);
  };
  visit(root);
  // (1) discover.
  for (let i = 0; i < found.length; i++) {
    const v = found[i];
    if (v instanceof Map) { for (const [k, x] of v) { visit(k); visit(x); } continue; }
    if (v instanceof Set) { for (const x of v) visit(x); continue; }
    if (Array.isArray(v)) { for (let j = 0; j < v.length; j++) visit(v[j]); continue; }
    const names = Object.getOwnPropertyNames(v);
    for (let j = 0; j < names.length; j++) {
      const d = Object.getOwnPropertyDescriptor(v, names[j]);
      if ('value' in d) visit(d.value);
    }
  }
  // (2) shallow copies (plain writable enumerable fields only; the rest in 3).
  const special = [];
  for (let i = 0; i < found.length; i++) {
    const v = found[i];
    let c;
    if (v instanceof Map) c = new Map();
    else if (v instanceof Set) c = new Set();
    else if (Array.isArray(v)) c = [];
    else {
      const proto = Object.getPrototypeOf(v);
      const keys = Object.keys(v);
      let simple = true;
      for (let j = 0; j < keys.length && simple; j++) {
        const d = Object.getOwnPropertyDescriptor(v, keys[j]);
        if (!('value' in d) || !d.writable || !d.configurable) simple = false;
      }
      if (simple) c = copierFor(proto, keys)(v, keys, proto);
      else { c = proto === Object.prototype ? {} : Object.create(proto); special.push(v, c, keys); }
      if (Object.getOwnPropertyNames(v).length !== keys.length) special.push(v, c, null);
    }
    seen.set(v, c);
  }
  const map = (x) => (x !== null && typeof x === 'object' ? seen.get(x) : x);
  // (3) containers, references, and fields with attributes.
  for (let i = 0; i < found.length; i++) {
    const v = found[i];
    const c = seen.get(v);
    if (v instanceof Map) { for (const [k, x] of v) c.set(map(k), map(x)); continue; }
    if (v instanceof Set) { for (const x of v) c.add(map(x)); continue; }
    if (Array.isArray(v)) {
      // push keeps a packed array packed, like the original (holes stay holes).
      for (let j = 0; j < v.length; j++) { if (j in v) c.push(map(v[j])); else c.length = j + 1; }
      continue;
    }
    const keys = Object.keys(v);
    for (let j = 0; j < keys.length; j++) {
      const x = c[keys[j]];
      if (x !== null && typeof x === 'object' && Object.prototype.hasOwnProperty.call(c, keys[j])) {
        const d = Object.getOwnPropertyDescriptor(c, keys[j]);
        if (d.writable) c[keys[j]] = map(x);
      }
    }
  }
  for (let i = 0; i < special.length; i += 3) {
    const v = special[i];
    const c = special[i + 1];
    const keys = special[i + 2];
    const names = keys || Object.getOwnPropertyNames(v).filter((k) => !Object.prototype.propertyIsEnumerable.call(v, k));
    for (const k of names) {
      const d = Object.getOwnPropertyDescriptor(v, k);
      if ('value' in d) d.value = map(d.value);
      Object.defineProperty(c, k, d);
    }
  }
  return seen.get(root);
}

// planck-js state that lives in bound functions / closures, rebuilt on a
// copied World (found by shape, never by name).
function planckFixups(world) {
  if (!world || typeof world.createContact !== 'function') return;
  world.addPair = world.createContact.bind(world);
  const bp = world.m_broadPhase;
  if (!bp) return;
  if (Object.prototype.hasOwnProperty.call(bp, 'queryCallback')) bp.queryCallback = Object.getPrototypeOf(bp).queryCallback.bind(bp);
  const tree = bp.m_tree;
  if (!tree || !tree.m_pool) return;
  const sample = tree.m_root || Object.values(tree.m_nodes || {})[0];
  if (!sample) throw new Error('sim snapshot: empty planck tree, no node type to rebuild its pool');
  const Pool = tree.m_pool.constructor;
  const TreeNode = sample.constructor;
  tree.m_pool = new Pool({ create: () => new TreeNode() });
}

/**
 * Copy of the sim state parts (an object of named roots, copied together so
 * shared references stay shared), with planck's closures rebuilt.
 */
export function copySimState(parts, keep) {
  const copy = deepCopy(parts, { keep });
  planckFixups(copy.map && copy.map.world);
  return copy;
}
