// Own boat in a remote room (RemoteHost, apps/server): the "Join with my
// boat" control in the Player menu tab. The server spawns a boat at a free
// spawn point and this connection owns it: its keys and touch buttons steer
// only that boat (the server sends this client's key binding, bindControls
// with boats 1), and the camera follows it. Without a boat (before joining,
// after Leave) the page is spectating: the server drops its boat commands,
// it has no key binding, the touch buttons dim, and the instrument panel
// selects its Player menu tab (instrument-panel.js setSpectating). That tab
// holds every own-boat control: the name field (#boat_name, saved with the
// player prefs) next to Join / Leave, "Join with my boat" while spectating,
// and Leave / Add second player / Remove player 2 / status once joined. The
// Preferences settings drawer no longer holds the name, zoom or pan controls.
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
// savePrefs: saves the player prefs after a name edit (player-prefs.js only
// saves trusted DOM edits; call it after our own input handler too).
export function setupOwnBoat(host, onChange, { savePrefs = null } = {}, doc = document) {
  const join = doc.getElementById('own_boat_join');
  if (!join || host.kind !== 'remote') return;
  const leave = doc.getElementById('own_boat_leave');
  const add = doc.getElementById('own_boat_add');
  const remove2 = doc.getElementById('own_boat_remove2');
  const nameEl = doc.getElementById('boat_name');
  const status = doc.getElementById('own_boat_status');
  const touch = doc.getElementById('touch_controls');
  let own = host.own || [];
  let error = '';
  // Name lives only in the Player menu (#boat_name). Enter joins while
  // spectating; edits always save into player prefs for the next join.
  if (nameEl) {
    nameEl.addEventListener('input', () => { if (savePrefs) savePrefs(); });
    nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && join && !join.hidden) join.click();
    });
  }
  const render = () => {
    const spectating = own.length === 0;
    join.hidden = !spectating;
    leave.hidden = spectating;
    if (add) add.hidden = spectating || own.length >= 2;
    if (remove2) remove2.hidden = own.length < 2;
    // Name stays visible while sailing so players can edit the saved name
    // next to Join / Leave (live boat names are set at spawn).
    if (nameEl) nameEl.hidden = false;
    status.textContent = error || (spectating ? '' : own.length > 1
      ? 'Sailing ' + own[0].name + ' (arrows) and ' + own[1].name + ' (A / D, W / S) · zoom = / -'
      : 'Sailing ' + own.map((b) => b.name).join(', ') + ' · arrows / touch steer it');
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
  join.addEventListener('click', () => {
    const name = (nameEl ? nameEl.value : '').trim();
    host.command({ type: 'spawnBoat', name, color: colorFor(name || String(Math.random())) }).then((r) => {
      if (r && r.error) { error = 'Cannot join: ' + r.error; render(); }
    });
  });
  if (add) add.addEventListener('click', () => {
    const base = (nameEl && nameEl.value.trim()) || (own[0] && own[0].name) || 'Player';
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
