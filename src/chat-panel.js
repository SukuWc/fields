import { DESKTOP_QUERY } from './layout.js';
import { chatTimeOf } from './chat-log.js';
// Chat panel: a small collapsible box, apart from the Player and Room
// settings panels. In a server room messages come from the server
// (apps/server/room.js: welcome history, then 'chat' events) and are shown
// as plain text (textContent only, never HTML). The sender shows as their
// name, boat number and boat colour. Typing here never steers: the helm
// keys ignore focused inputs (controls.js typingInControl), and pointer /
// touch / wheel events stay inside the panel. On desktop the chat opens by
// default (it has its own column); elsewhere it starts closed.
//
// Every line starts with its time (chat-log.js chatTimeOf): race time from
// the start ("+2:13", "−0:45") when the message has one, else local HH:MM.
//
// Rule calls (penalties and cleared penalties, rule-toasts.js) are added on
// this client with addRule() as system lines (.chat-sys.chat-rule), in every
// mode. Local and worker games have no one to talk to: the panel still shows
// as a log of those rule lines, with the input disabled, the quick messages
// hidden and a short note (#chat_note); #chat_placeholder stays hidden.
// A replay (?replay=<id>) is the same read-only log, plus the recorded
// race chat, which the ReplayHost sends as chat events at their ticks.
const STOP_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'wheel', 'click', 'keydown', 'keyup'];
const MAX_LINES = 50;
// Quick messages (one tap sends): part of the chat shell on every size
// (standardization PR 7), so desktop, tablet and the phone sheet share them.
export const QUICK_MESSAGES = ['👍 Nice', '⚠ Starboard!', 'Room please', 'GG'];

function isDesktop() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches;
}

function hex(c) { return Number.isInteger(c) && c >= 0 && c <= 0xffffff ? '#' + c.toString(16).padStart(6, '0') : null; }

export function setupChat(host, doc = document, { desktop = isDesktop() } = {}) {
  const panel = doc.getElementById('chat_panel');
  const placeholder = doc.getElementById('chat_placeholder');
  if (!panel) return null;
  const remote = host.kind === 'remote' && typeof host.sendChat === 'function';
  if (placeholder) placeholder.hidden = true;
  panel.hidden = false;
  panel.classList.toggle('chat-solo', !remote);
  const toggle = doc.getElementById('chat_toggle');
  const body = doc.getElementById('chat_body');
  const log = doc.getElementById('chat_log');
  const form = doc.getElementById('chat_form');
  const input = doc.getElementById('chat_input');
  const send = doc.getElementById('chat_send');
  const status = doc.getElementById('chat_status');
  const badge = doc.getElementById('chat_unread');
  const quick = doc.getElementById('chat_quick');
  const note = doc.getElementById('chat_note');
  if (note) note.hidden = remote;
  if (!remote) {
    input.disabled = true;
    input.placeholder = 'Chat is available in multiplayer rooms';
    if (send) send.disabled = true;
    if (quick) quick.hidden = true;
  }
  // Replay (replay-host.js): the race's chat plays back here; nothing is sent.
  if (host.kind === 'replay') {
    if (note) note.textContent = 'Replay: the race chat appears as the replay reaches it. Penalties and clears are logged here too.';
    if (input) input.placeholder = 'Replay: chat is read-only';
  }
  if (remote && quick && !quick.childElementCount) {
    for (const text of QUICK_MESSAGES) {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'sz-btn chat-quick-btn'; b.textContent = text;
      b.addEventListener('click', () => {
        input.value = text;
        if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true }));
      });
      quick.appendChild(b);
    }
  }
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
    row.className = 'chat-line' + (msg.sys ? ' chat-sys' : '') + (msg.rule ? ' chat-rule chat-' + msg.rule : '');
    const tm = chatTimeOf(msg);
    const time = doc.createElement('span');
    time.className = 'chat-time';
    time.textContent = tm.text;
    if (tm.title) time.title = tm.title;
    row.appendChild(time);
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
  // Server lines and this client's rule lines, in order: a rule line sits
  // after the server line (seq) that was last when it came, so a history
  // replace (welcome on reconnect) keeps it in place.
  let server = [];
  const rules = [];
  let lastSeq = 0;
  const keys = new Set();
  const render = () => {
    while (log.firstChild) log.removeChild(log.firstChild);
    let r = 0;
    for (const m of server) {
      while (r < rules.length && rules[r].after < (m.seq || 0)) add(rules[r++].msg, false);
      add(m, false);
    }
    while (r < rules.length) add(rules[r++].msg, false);
  };
  const replace = (list) => {
    server = (list || []).slice(-MAX_LINES);
    lastSeq = server.reduce((a, m) => Math.max(a, m.seq || 0), lastSeq);
    render();
  };
  replace(host.chat);
  if (typeof host.on === 'function') {
    host.on((ev) => {
      if (ev.type === 'chat' && ev.msg) {
        server.push(ev.msg);
        if (server.length > MAX_LINES) server.shift();
        if (Number.isFinite(ev.msg.seq)) lastSeq = Math.max(lastSeq, ev.msg.seq);
        add(ev.msg);
      } else if (ev.type === 'chatHistory') replace(ev.chat);
    });
  }
  // Rule lines (chat-log.js RuleChatFeed messages); a key seen before is dropped.
  const addRule = (msg) => {
    if (!msg || (msg.key && keys.has(msg.key))) return;
    if (msg.key) keys.add(msg.key);
    rules.push({ after: lastSeq, msg });
    if (rules.length > MAX_LINES) rules.shift();
    add(msg);
  };
  if (remote) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value;
      if (!text.trim()) return;
      status.textContent = '';
      const r = await host.sendChat(text);
      if (r && r.ok) input.value = '';
      else status.textContent = (r && r.error) || 'not sent';
    });
  } else {
    form.addEventListener('submit', (e) => e.preventDefault());
  }
  setOpen(!!desktop);
  return { setOpen, add, addRule, remote };
}
