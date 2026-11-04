// Leaderboard and chat sheet on phones (mobile plan M9).
//
// A top-bar button opens a bottom sheet (a side sheet in landscape) with two
// tabs: Leaderboard and Chat. On phones the existing #finish_results and
// #chat_body elements are moved into the sheet, so main.js and chat-panel.js
// keep driving them unchanged; on wider screens nothing moves. The Chat tab
// opens / closes the chat through its own toggle, so the unread count keeps
// working, and the button mirrors that count. Quick messages fill the chat
// input and send it through the chat form. Local and worker modes have no
// chat: only the Leaderboard tab shows.

import { TABLET_QUERY } from './touch-controls.js';
import { setupSheetSwipe } from './sheet-swipe.js';

export const SHEET_QUERY = '(max-width: 768px), (pointer: coarse) and (hover: none)';
export const QUICK_MESSAGES = ['👍 Nice', '⚠ Starboard!', 'Room please', 'GG'];
const STOP_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'wheel', 'click', 'keyup'];

export function setupMobileSheet(doc = document) {
  const sheet = doc.getElementById('mobile_sheet');
  const btn = doc.getElementById('sheet_toggle');
  if (!sheet || !btn) return null;
  const board = doc.getElementById('sheet_board');
  const chatPane = doc.getElementById('sheet_chat');
  const tabBoard = doc.getElementById('sheet_tab_board');
  const tabChat = doc.getElementById('sheet_tab_chat');
  const results = doc.getElementById('finish_results');
  const chatPanel = doc.getElementById('chat_panel');
  const chatBody = doc.getElementById('chat_body');
  const chatToggle = doc.getElementById('chat_toggle');
  const chatUnread = doc.getElementById('chat_unread');
  const badge = btn.querySelector('.st-badge');
  const tabBadge = tabChat && tabChat.querySelector('.st-badge');
  const quick = doc.getElementById('sheet_quick');
  const q = window.matchMedia ? window.matchMedia(SHEET_QUERY) : null;
  // Tablet (plan M10): the leaderboard stays on the map; the sheet is chat only.
  const tq = window.matchMedia ? window.matchMedia(TABLET_QUERY) : null;
  const isTablet = () => !!(tq && tq.matches);
  const home = new Map(); // element -> [parent, nextSibling]
  let open = false, tab = 'board';

  const hasChat = () => !!(chatPanel && !chatPanel.hidden && chatBody);
  const chatOpen = () => chatToggle && chatToggle.getAttribute('aria-expanded') === 'true';
  const setChat = (on) => { if (hasChat() && chatOpen() !== on) chatToggle.click(); };

  function moveIn(el, pane) {
    if (!el || !pane || el.parentNode === pane) return;
    if (!home.has(el)) home.set(el, [el.parentNode, el.nextSibling]);
    pane.insertBefore(el, pane.firstChild);
  }
  function moveOut(el) {
    const h = home.get(el);
    if (!h) return;
    h[0].insertBefore(el, h[1] && h[1].parentNode === h[0] ? h[1] : null);
    home.delete(el);
  }
  function place() {
    const phone = !!(q && q.matches);
    doc.body.classList.toggle('sheet-on', phone);
    if (phone) { if (isTablet()) moveOut(results); else moveIn(results, board); moveIn(chatBody, chatPane); }
    else { if (open) setOpen(false); moveOut(results); moveOut(chatBody); }
  }
  function syncBadge() {
    const n = chatUnread && !chatUnread.hidden ? Number(chatUnread.textContent) || 0 : 0;
    for (const b of [badge, tabBadge]) if (b) { b.hidden = n === 0; b.textContent = String(n); }
  }
  function render() {
    sheet.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    doc.body.classList.toggle('sheet-open', open);
    const chat = hasChat();
    if (tabChat) tabChat.hidden = !chat;
    if (!chat) tab = 'board';
    if (isTablet() && chat) tab = 'chat';
    if (tabBoard) tabBoard.hidden = isTablet();
    btn.hidden = isTablet() && !chat;
    sheet.dataset.tab = tab;
    if (tabBoard) tabBoard.setAttribute('aria-selected', String(tab === 'board'));
    if (tabChat) tabChat.setAttribute('aria-selected', String(tab === 'chat'));
    setChat(open && tab === 'chat');
    syncBadge();
  }
  function setOpen(v) { open = v; render(); }
  function setTab(t) { tab = t; render(); }

  btn.addEventListener('click', () => setOpen(!open));
  const handle = sheet.querySelector('.sheet-handle');
  if (handle) handle.addEventListener('click', () => setOpen(false));
  // Swipe down (bottom sheet) or right (landscape side sheet) closes it.
  setupSheetSwipe(sheet, {
    isSide: () => sheet.getBoundingClientRect().left > 1,
    close: () => setOpen(false),
  });
  if (tabBoard) tabBoard.addEventListener('click', () => setTab('board'));
  if (tabChat) tabChat.addEventListener('click', () => setTab('chat'));
  if (quick) {
    for (const text of QUICK_MESSAGES) {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'sheet-quick-btn'; b.textContent = text;
      b.addEventListener('click', () => {
        const input = doc.getElementById('chat_input');
        const form = doc.getElementById('chat_form');
        if (!input || !form) return;
        input.value = text;
        if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true }));
      });
      quick.appendChild(b);
    }
  }
  // Nothing in the sheet reaches the canvas or document-level listeners.
  for (const type of STOP_EVENTS) sheet.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  if (chatUnread && typeof MutationObserver === 'function') {
    new MutationObserver(syncBadge).observe(chatUnread, { attributes: true, childList: true, characterData: true, subtree: true });
  }
  if (chatPanel && typeof MutationObserver === 'function') {
    new MutationObserver(render).observe(chatPanel, { attributes: true, attributeFilter: ['hidden'] });
  }
  if (q && q.addEventListener) q.addEventListener('change', place);
  if (tq && tq.addEventListener) tq.addEventListener('change', () => { place(); render(); });
  place();
  render();
  return { setOpen, setTab, get open() { return open; }, get tab() { return tab; } };
}
