// syncListChildren: keep room-card nodes in place when the id set/order is
// unchanged so a focused TOML textarea is not remounted by the 5 s poll.
import { syncListChildren } from '../apps/landing/room-admin.js';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed++;
};

/** Minimal parent/child DOM for insertBefore / remove / children. */
function makeNode(id) {
  const node = {
    id,
    parent: null,
    children: [],
    contains(other) {
      if (other === this) return true;
      for (const c of this.children) if (c === other || c.contains(other)) return true;
      return false;
    },
    remove() {
      if (!this.parent) return;
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    },
    focus() { document.activeElement = this; },
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    get isConnected() { return this.parent != null || this._forceConnected === true; },
  };
  return node;
}

function makeParent() {
  const parent = makeNode('parent');
  parent.insertBefore = function (node, ref) {
    if (node.parent) node.remove();
    if (ref == null) {
      this.children.push(node);
    } else {
      const i = this.children.indexOf(ref);
      this.children.splice(i < 0 ? this.children.length : i, 0, node);
    }
    node.parent = this;
    return node;
  };
  parent.append = function (...nodes) {
    for (const n of nodes) this.insertBefore(n, null);
  };
  return parent;
}

const root = makeParent();
globalThis.document = { activeElement: null };

const a = makeNode('a');
const b = makeNode('b');
const c = makeNode('c');
root.append(a, b);

let mutated = syncListChildren(root, [a, b]);
check('unchanged order: no mutation', mutated === false && root.children[0] === a && root.children[1] === b);

document.activeElement = b;
b.scrollTop = 42;
b.selectionStart = 3;
b.selectionEnd = 5;
mutated = syncListChildren(root, [a, b]);
check('unchanged while focused: still no mutation', mutated === false);
check('focus + scroll preserved when noop', document.activeElement === b && b.scrollTop === 42);

mutated = syncListChildren(root, [b, a]);
check('reorder mutates', mutated === true && root.children[0] === b && root.children[1] === a);
check('focus restored after reorder', document.activeElement === b);
check('selection + scroll restored after reorder', b.selectionStart === 3 && b.selectionEnd === 5 && b.scrollTop === 42);

mutated = syncListChildren(root, [b, a, c]);
check('append new node', mutated === true && root.children.length === 3 && root.children[2] === c && c.parent === root);

mutated = syncListChildren(root, [a]);
check('drop extras', mutated === true && root.children.length === 1 && root.children[0] === a);
check('dropped nodes detached', b.parent === null && c.parent === null);

if (failed) {
  console.error(failed + ' failure(s)');
  process.exit(1);
}
console.log('all landing-list-sync checks passed');
