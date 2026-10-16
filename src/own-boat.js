// Own boat in a remote room (RemoteHost, apps/server): the "Join with my
// boat" control in the settings panel. The server spawns a boat at a free
// spawn point and this connection owns it: its keys and touch buttons
// (bound as boat 0) steer only that boat, and the camera follows it. Leave,
// a disconnect or a room-wide scenario restart removes it.
import { bindKeysForBoats } from './controls.js';

const PALETTE = [0xd81b60, 0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00897b, 0x6d4c41, 0x3949ab];

function colorFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// onChange(ids): called with this client's boat ids (first = followed).
export function setupOwnBoat(host, onChange) {
  const panel = document.getElementById('own_boat_panel');
  if (!panel || host.kind !== 'remote') return;
  panel.hidden = false;
  const join = document.getElementById('own_boat_join');
  const leave = document.getElementById('own_boat_leave');
  const nameEl = document.getElementById('boat_name');
  const status = document.getElementById('own_boat_status');
  let own = [];
  const render = () => {
    join.hidden = own.length > 0;
    leave.hidden = own.length === 0;
    status.textContent = own.length ? 'Sailing ' + own.map((b) => b.name).join(', ') + ' · arrows / touch steer it' : '';
  };
  host.on((ev) => {
    if (ev.type !== 'ownBoats') return;
    const had = own.length;
    own = ev.boats || [];
    if (own.length && !had) {
      bindKeysForBoats(1);
      const follow = document.getElementById('camera_follow');
      if (follow && !follow.checked) { follow.checked = true; follow.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    render();
    onChange(own.map((b) => b.id));
  });
  join.addEventListener('click', () => {
    const name = nameEl.value.trim();
    host.command({ type: 'spawnBoat', name, color: colorFor(name || String(Math.random())) });
  });
  leave.addEventListener('click', () => { for (const b of own) host.command({ type: 'removeBoat', id: b.id }); });
  render();
}
