// Own boat in a remote room (RemoteHost, apps/server): the "Join with my
// boat" control in the player panel. The server spawns a boat at a free
// spawn point and this connection owns it: its keys and touch buttons steer
// only that boat (the server sends this client's key binding, bindControls
// with boats 1), and the camera follows it. Without a boat (before joining,
// after Leave) the page is spectating: the server drops its boat commands,
// it has no key binding, and the player panel and touch panel say so.
// Leave or a disconnect removes the boat; a room-wide restart keeps it (the
// server spawns it again with the same name and colour).

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
  const note = document.getElementById('spectating_note');
  const touch = document.getElementById('touch_controls');
  let own = host.own || [];
  let error = '';
  const render = () => {
    const spectating = own.length === 0;
    join.hidden = !spectating;
    leave.hidden = spectating;
    status.textContent = error || (spectating ? '' : 'Sailing ' + own.map((b) => b.name).join(', ') + ' · arrows / touch steer it');
    if (note) note.hidden = !spectating;
    if (touch) touch.classList.toggle('spectating', spectating);
    document.body.classList.toggle('spectating', spectating);
  };
  host.on((ev) => {
    if (ev.type !== 'ownBoats') return;
    const had = own.length;
    own = ev.boats || [];
    error = '';
    if (own.length && !had) {
      const follow = document.getElementById('camera_follow');
      if (follow && !follow.checked) { follow.checked = true; follow.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    render();
    onChange(own.map((b) => b.id));
  });
  join.addEventListener('click', () => {
    const name = nameEl.value.trim();
    host.command({ type: 'spawnBoat', name, color: colorFor(name || String(Math.random())) }).then((r) => {
      if (r && r.error) { error = 'Cannot join: ' + r.error; render(); }
    });
  });
  leave.addEventListener('click', () => { for (const b of own) host.command({ type: 'removeBoat', id: b.id }); });
  render();
  onChange(own.map((b) => b.id));
}
