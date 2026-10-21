// Chat panel (remote / server mode only): a small collapsible box, apart
// from the Player and Room settings panels. Messages come from the server
// (apps/server/room.js: welcome history, then 'chat' events) and are shown
// as plain text (textContent only, never HTML). The sender shows as their
// name, boat number and boat colour. Typing here never steers: the helm
// keys ignore focused inputs (controls.js typingInControl), and pointer /
// touch / wheel events stay inside the panel. Local and worker modes have no
// chat (there is nobody to talk to): the panel stays hidden.
const STOP_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'wheel', 'click', 'keydown', 'keyup'];
const MAX_LINES = 50;

function hex(c) { return Number.isInteger(c) && c >= 0 && c <= 0xffffff ? '#' + c.toString(16).padStart(6, '0') : null; }

export function setupChat(host, doc = document) {
  const panel = doc.getElementById('chat_panel');
  if (!panel) return null;
  if (host.kind !== 'remote' || typeof host.sendChat !== 'function') { panel.hidden = true; return null; }
  panel.hidden = false;
  const toggle = doc.getElementById('chat_toggle');
  const body = doc.getElementById('chat_body');
  const log = doc.getElementById('chat_log');
  const form = doc.getElementById('chat_form');
  const input = doc.getElementById('chat_input');
  const status = doc.getElementById('chat_status');
  const badge = doc.getElementById('chat_unread');
  let unread = 0;
  let open = false;
  const setOpen = (v) => {
    open = v;
    body.hidden = !v;
    toggle.setAttribute('aria-expanded', String(v));
    if (v) { unread = 0; log.scrollTop = log.scrollHeight; }
    badge.hidden = unread === 0;
    badge.textContent = String(unread);
  };
  for (const type of STOP_EVENTS) panel.addEventListener(type, (e) => { if (type !== 'keydown' || e.key !== 'Escape') e.stopPropagation(); }, { passive: type !== 'keydown' && type !== 'click' && type !== 'keyup' });
  toggle.addEventListener('click', () => setOpen(!open));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.blur(); setOpen(false); } });

  const line = (msg) => {
    const row = doc.createElement('div');
    row.className = msg.sys ? 'chat-line chat-sys' : 'chat-line';
    if (!msg.sys && msg.from) {
      const who = doc.createElement('span');
      who.className = 'chat-who';
      const c = hex(msg.from.color);
      if (c) { const dot = doc.createElement('span'); dot.className = 'chat-dot'; dot.style.background = c; row.appendChild(dot); who.style.color = c; }
      who.textContent = msg.from.name + (Number.isInteger(msg.from.n) ? ' #' + msg.from.n : '') + ': ';
      row.appendChild(who);
    }
    const text = doc.createElement('span');
    text.className = 'chat-text';
    text.textContent = String(msg.text);
    row.appendChild(text);
    return row;
  };
  const add = (msg, count = true) => {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
    log.appendChild(line(msg));
    while (log.childNodes.length > MAX_LINES) log.removeChild(log.firstChild);
    if (stick || !open) log.scrollTop = log.scrollHeight;
    if (count && !open && !msg.sys) { unread++; badge.hidden = false; badge.textContent = String(unread); }
  };
  const replace = (list) => { log.textContent = ''; for (const m of list || []) add(m, false); };
  replace(host.chat);
  host.on((ev) => {
    if (ev.type === 'chat' && ev.msg) add(ev.msg);
    else if (ev.type === 'chatHistory') replace(ev.chat);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value;
    if (!text.trim()) return;
    status.textContent = '';
    const r = await host.sendChat(text);
    if (r && r.ok) input.value = '';
    else status.textContent = (r && r.error) || 'not sent';
  });
  setOpen(false);
  return { setOpen, add };
}
