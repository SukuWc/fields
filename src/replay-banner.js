// Replay banner (?replay=<id>): a small bar over the race view with the
// replay status (src/replay-host.js replayStatusText), Play / Pause and a
// link back to the room list. Created on the fly; the page HTML is unchanged.
import { replayStatusText } from './replay-host.js';

export function setupReplayBanner(host, doc = document) {
  const bar = doc.createElement('div');
  bar.id = 'replay_banner';
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:fixed', 'top:calc(8px + env(safe-area-inset-top))', 'left:50%', 'transform:translateX(-50%)',
    'z-index:1000', 'display:flex', 'gap:10px', 'align-items:center', 'padding:6px 12px',
    'border-radius:8px', 'background:rgba(15,23,42,0.85)', 'color:#fff',
    'font:13px/1.3 system-ui,sans-serif', 'max-width:calc(100vw - 24px)',
  ].join(';');
  const title = doc.createElement('strong');
  const text = doc.createElement('span');
  text.id = 'replay_status';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.id = 'replay_pause';
  btn.textContent = 'Pause';
  btn.style.cssText = 'font:inherit;padding:2px 8px;border-radius:6px;border:1px solid #fff4;background:#fff2;color:#fff;cursor:pointer';
  btn.addEventListener('click', () => { host.setPaused(!host.paused); btn.blur(); });
  const back = doc.createElement('a');
  back.href = '/';
  back.textContent = 'Rooms';
  back.style.cssText = 'color:#9cd3ff';
  bar.append(title, text, btn, back);
  doc.body.appendChild(bar);
  let last = '';
  host.onStatus((st) => {
    const head = st.room ? `${st.room}${st.players && st.players.length ? ' · ' + st.players.join(', ') : ''}` : 'Replay';
    if (title.textContent !== head) title.textContent = head;
    const s = replayStatusText(st);
    if (s !== last) { last = s; text.textContent = s; }
    bar.dataset.state = st.error ? 'error' : st.mismatch ? 'mismatch' : st.done ? 'done' : 'playing';
    text.style.color = st.error || st.mismatch ? '#ff9b9b' : st.done ? '#a6f4b5' : '';
    btn.hidden = !!(st.done || st.error);
    btn.textContent = st.paused ? 'Play' : 'Pause';
  });
  return bar;
}
