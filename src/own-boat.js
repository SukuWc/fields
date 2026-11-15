// Own boat in a remote room (RemoteHost, apps/server): the "Join with my
// boat" control in the player panel. The server spawns a boat at a free
// spawn point and this connection owns it: its keys and touch buttons steer
// only that boat (the server sends this client's key binding, bindControls
// with boats 1), and the camera follows it. Without a boat (before joining,
// after Leave) the page is spectating: the server drops its boat commands,
// it has no key binding, the touch buttons dim, and the instrument panel
// shows its Join tab (instrument-panel.js setSpectating): the name field
// there (#join_tab_name) mirrors the saved Player name (#boat_name, the one
// value both read) and "Join with my boat" (#own_boat_join) lives in that tab.
// The settings drawer keeps the name, Leave and the second-player controls.
// "Add second player" spawns a second boat owned by the same connection (the
// server binds two players: see controls.js for the keys) and the camera
// follows the midpoint of the two. Leave or a disconnect removes the boat(s); a room-wide restart keeps it (the
// server spawns it again with the same name and colour).

const PALETTE = [0xd81b60, 0x1e88e5, 0x43a047, 0xfb8c00, 0x8e24aa, 0x00897b, 0x6d4c41, 0x3949ab];

function colorFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// onChange(ids): called with this client's boat ids (first = followed).
// savePrefs: saves the Player prefs after a Join-tab name edit (the mirror
// writes #boat_name programmatically, which player-prefs.js does not save).
export function setupOwnBoat(host, onChange, { savePrefs = null } = {}, doc = document) {
  const panel = doc.getElementById('own_boat_panel');
  if (!panel || host.kind !== 'remote') return;
  panel.hidden = false;
  const join = doc.getElementById('own_boat_join');
  const leave = doc.getElementById('own_boat_leave');
  const add = doc.getElementById('own_boat_add');
  const remove2 = doc.getElementById('own_boat_remove2');
  const nameEl = doc.getElementById('boat_name');
  const status = doc.getElementById('own_boat_status');
  const tabName = doc.getElementById('join_tab_name');
  const tabStatus = doc.getElementById('join_tab_status');
  const touch = doc.getElementById('touch_controls');
  let own = host.own || [];
  let error = '';
  // Join-tab name <-> saved Player name: #boat_name holds the value.
  if (tabName && nameEl) {
    tabName.value = nameEl.value;
    const fromSaved = () => { if (tabName.value !== nameEl.value) tabName.value = nameEl.value; };
    nameEl.addEventListener('input', fromSaved);
    nameEl.addEventListener('change', fromSaved);
    tabName.addEventListener('input', () => {
      nameEl.value = tabName.value;
      nameEl.dispatchEvent(new Event('input', { bubbles: true }));
      nameEl.dispatchEvent(new Event('change', { bubbles: true }));
      if (savePrefs) savePrefs();
    });
    tabName.addEventListener('keydown', (e) => { if (e.key === 'Enter' && join) join.click(); });
  }
  const render = () => {
    const spectating = own.length === 0;
    if (join) join.hidden = !spectating;
    leave.hidden = spectating;
    if (add) add.hidden = spectating || own.length >= 2;
    if (remove2) remove2.hidden = own.length < 2;
    status.textContent = error || (spectating ? '' : own.length > 1
      ? 'Sailing ' + own[0].name + ' (arrows) and ' + own[1].name + ' (A / D, W / S) · zoom = / -'
      : 'Sailing ' + own.map((b) => b.name).join(', ') + ' · arrows / touch steer it');
    if (tabStatus) tabStatus.textContent = spectating ? error : '';
    if (touch) touch.classList.toggle('spectating', spectating);
    doc.body.classList.toggle('spectating', spectating);
  };
  host.on((ev) => {
    if (ev.type !== 'ownBoats') return;
    const had = own.length;
    own = ev.boats || [];
    error = '';
    if (own.length && !had) {
      const follow = doc.getElementById('camera_follow');
      if (follow && !follow.checked) { follow.checked = true; follow.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    render();
    onChange(own.map((b) => b.id));
  });
  if (join) join.addEventListener('click', () => {
    if (tabName) nameEl.value = tabName.value;
    const name = nameEl.value.trim();
    host.command({ type: 'spawnBoat', name, color: colorFor(name || String(Math.random())) }).then((r) => {
      if (r && r.error) { error = 'Cannot join: ' + r.error; render(); }
    });
  });
  if (add) add.addEventListener('click', () => {
    const base = nameEl.value.trim() || (own[0] && own[0].name) || 'Player';
    const name = base + ' 2';
    host.command({ type: 'spawnBoat', name, color: colorFor(name) }).then((r) => {
      if (r && r.error) { error = 'Cannot add: ' + r.error; render(); }
    });
  });
  if (remove2) remove2.addEventListener('click', () => { if (own[1]) host.command({ type: 'removeBoat', id: own[1].id }); });
  leave.addEventListener('click', () => { for (const b of own) host.command({ type: 'removeBoat', id: b.id }); });
  render();
  onChange(own.map((b) => b.id));
}
