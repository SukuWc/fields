// Replay banner (?replay=<id>): a bar over the race view with the replay
// status (src/replay-host.js replayStatusText), a link back to the room list
// and the timeline (replay seeking, part 3): Play / Pause, speed 1x / 2x / 4x,
// a scrub bar with the current and total race time, the part the worker has
// already simulated shaded (seeks there are quick: a keyframe is near), and
// while a seek runs 'Simulating 3:12 → 7:40' with Cancel. Created on the fly;
// the page HTML is unchanged. The state lives in the host; the banner only
// draws host.status() and calls setPaused / setSpeed / seek / cancelSeek.
import { replayStatusText } from './replay-host.js';

const STYLE = `
#replay_banner button{font:inherit;padding:2px 8px;border-radius:6px;border:1px solid #fff4;background:#fff2;color:#fff;cursor:pointer}
#replay_banner button[aria-pressed="true"]{background:#4aa8ff;border-color:#4aa8ff;color:#06203a}
#replay_banner button:focus-visible,#replay_timeline:focus-within{outline:2px solid #9cd3ff;outline-offset:2px}
#replay_timeline{position:relative;flex:1;min-width:120px;height:18px;border-radius:9px}
#replay_timeline>div{position:absolute;top:6px;height:6px;border-radius:3px;pointer-events:none}
#replay_timeline input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
#replay_timeline .kf{top:4px;width:1px;height:10px;border-radius:0;background:#ffffff55}
#replay_timeline .thumb{top:2px;width:14px;height:14px;border-radius:7px;margin-left:-7px;background:#fff;box-shadow:0 0 0 2px #4aa8ff}
`;

/** Race time m:ss from ticks (30 per second). */
export function fmtTicks(n) {
  const s = Math.max(0, Math.floor((n || 0) / 30));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** 'Simulating 3:12 → 7:40' while a seek runs, else ''. */
export function seekText(st) {
  const sk = st && st.seeking;
  if (!sk) return '';
  return `Simulating ${fmtTicks(sk.at)} → ${fmtTicks(sk.to)}`;
}

export function setupReplayBanner(host, doc = document) {
  const el = (tag, props = {}, css = '') => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    if (css) e.style.cssText = css;
    return e;
  };
  const style = el('style', { textContent: STYLE });
  doc.head.appendChild(style);

  const bar = el('div', { id: 'replay_banner' }, [
    // Top left, clear of the race clock and start warnings in the middle.
    'position:fixed', 'top:calc(8px + env(safe-area-inset-top))', 'left:calc(12px + env(safe-area-inset-left))',
    'z-index:1000', 'display:flex', 'flex-direction:column', 'gap:4px', 'padding:6px 12px',
    'border-radius:8px', 'background:rgba(15,23,42,0.85)', 'color:#fff',
    'font:13px/1.3 system-ui,sans-serif', 'width:min(440px,calc(100vw - 24px))', 'box-sizing:border-box',
  ].join(';'));
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Replay');

  // Row 1: title, status, Rooms link.
  const row1 = el('div', {}, 'display:flex;gap:10px;align-items:center;min-width:0');
  const title = el('strong', {}, 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%');
  const text = el('span', { id: 'replay_status' }, 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
  text.setAttribute('role', 'status');
  const back = el('a', { href: '/', textContent: 'Rooms' }, 'color:#9cd3ff');
  row1.append(title, text, back);

  // Row 2: play / pause, time, scrub bar, total, speed.
  const row2 = el('div', {}, 'display:flex;gap:8px;align-items:center');
  const btn = el('button', { type: 'button', id: 'replay_pause', textContent: 'Pause' }, 'min-width:52px');
  const cur = el('span', { id: 'replay_time' }, 'font-variant-numeric:tabular-nums;min-width:34px;text-align:right');
  const total = el('span', { id: 'replay_total' }, 'font-variant-numeric:tabular-nums;min-width:34px');
  const line = el('div', { id: 'replay_timeline' });
  const track = el('div', {}, 'left:0;right:0;background:#ffffff22');
  const simulated = el('div', { className: 'simulated' }, 'left:0;width:0;background:#ffffff40');
  const played = el('div', { className: 'played' }, 'left:0;width:0;background:#4aa8ff');
  const seekRun = el('div', { className: 'seekrun' }, 'left:0;width:0;background:#ffd166');
  const marks = el('div', {}, 'left:0;right:0;top:0;height:18px');
  const thumb = el('div', { className: 'thumb' }, 'left:0');
  const range = el('input', { type: 'range', id: 'replay_scrub', min: '0', max: '0', step: '1', value: '0' });
  range.setAttribute('aria-label', 'Race time');
  line.append(track, simulated, seekRun, played, marks, thumb, range);
  const speeds = el('div', { id: 'replay_speed' }, 'display:flex;gap:2px');
  speeds.setAttribute('role', 'group');
  speeds.setAttribute('aria-label', 'Speed');
  const speedBtns = [1, 2, 4].map((n) => {
    const b = el('button', { type: 'button', textContent: n + 'x' }, 'padding:2px 6px');
    b.dataset.speed = String(n);
    b.addEventListener('click', () => { host.setSpeed(n); b.blur(); });
    speeds.append(b);
    return b;
  });
  row2.append(btn, cur, line, total, speeds);

  // In row 1 while a seek runs (instead of the status): progress and Cancel.
  const seekBox = el('span', { id: 'replay_seek' }, 'display:none;flex:1;min-width:0;gap:8px;align-items:center');
  const seekLabel = el('span', { id: 'replay_seek_text' }, 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#ffd166');
  seekLabel.setAttribute('role', 'status');
  const cancel = el('button', { type: 'button', id: 'replay_seek_cancel', textContent: 'Cancel' });
  cancel.addEventListener('click', () => { host.cancelSeek(); cancel.blur(); });
  seekBox.append(seekLabel, cancel);
  row1.insertBefore(seekBox, back);

  bar.append(row1, row2);
  doc.body.appendChild(bar);

  let st = host.status();
  let dragging = false;
  // A seek sent but not yet acknowledged: the thumb stays at its target.
  let pending = null;
  btn.addEventListener('click', () => {
    // At the end, Play starts over.
    if (st.done && st.ticks) { host.seek(0); host.setPaused(false); } else host.setPaused(!host.paused);
    btn.blur();
  });
  range.addEventListener('input', () => { dragging = true; draw(); });
  range.addEventListener('change', () => {
    dragging = false;
    const t = Number(range.value);
    if (Number.isFinite(t) && t !== st.t) { pending = t; host.seek(t); }
    range.blur();
    draw();
  });
  // Keys on the scrub bar must not reach the game's key handlers.
  range.addEventListener('keydown', (e) => e.stopPropagation());

  let lastText = '';
  let markKey = '';
  const pct = (n) => (st.ticks ? Math.max(0, Math.min(100, (100 * n) / st.ticks)) : 0) + '%';
  function draw() {
    const head = st.room ? `${st.room}${st.players && st.players.length ? ' · ' + st.players.join(', ') : ''}` : 'Replay';
    if (title.textContent !== head) title.textContent = head;
    const s = replayStatusText(st, { position: false });
    if (s !== lastText) { lastText = s; text.textContent = s; }
    bar.dataset.state = st.error ? 'error' : st.mismatch ? 'mismatch' : st.seeking ? 'seeking' : st.done ? 'done' : st.paused ? 'paused' : 'playing';
    text.style.color = st.error || st.mismatch ? '#ff9b9b' : st.done ? '#a6f4b5' : '';
    const ready = !!st.ticks && !st.error;
    // style.display, not hidden: the inline display:flex would win over [hidden].
    row2.style.display = ready ? 'flex' : 'none';
    btn.textContent = st.done ? 'Replay' : st.paused ? 'Play' : 'Pause';
    btn.setAttribute('aria-label', st.done ? 'Play again' : st.paused ? 'Play' : 'Pause');
    if (!ready) return;
    range.max = String(st.ticks);
    const sk = st.seeking;
    const shown = dragging ? Number(range.value) : sk ? sk.to : pending !== null ? pending : st.t;
    if (!dragging) range.value = String(shown);
    range.setAttribute('aria-valuetext', `${fmtTicks(shown)} of ${fmtTicks(st.ticks)}`);
    cur.textContent = fmtTicks(shown);
    total.textContent = fmtTicks(st.ticks);
    played.style.width = pct(sk ? Math.min(sk.from, sk.to) : st.t);
    simulated.style.width = pct(Math.max(st.simulatedTo || 0, st.t));
    if (sk) {
      const a = Math.min(sk.start, sk.at);
      seekRun.style.left = pct(a);
      seekRun.style.width = pct(Math.max(0, sk.at - a));
    } else seekRun.style.width = '0';
    thumb.style.left = pct(shown);
    const kfs = st.keyframes || [];
    const key = st.ticks + ':' + kfs.join(',');
    if (key !== markKey) {
      markKey = key;
      marks.replaceChildren(...kfs.filter((t) => t > 0).map((t) => el('div', { className: 'kf' }, 'position:absolute;left:' + pct(t))));
    }
    for (const b of speedBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === (st.speed || 1)));
    seekBox.style.display = sk ? 'flex' : 'none';
    text.style.display = sk ? 'none' : '';
    if (sk) seekLabel.textContent = seekText(st);
  }
  host.onStatus((next) => {
    st = next;
    if (pending !== null && (st.seeking || st.t === pending || st.error)) pending = null;
    draw();
  });
  return bar;
}
