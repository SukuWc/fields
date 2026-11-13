// Light on-screen client perf readout, enabled with ?hud=1 (not to be
// confused with the existing #hud_top / #start_hud layout or the server
// ?perf= overlay). Updates the DOM a few times per second; a rAF hook
// only records frame intervals. RemoteHost counters are read if present.

const ON = new Set(['1', 'true', 'on', 'yes']);
const OFF = new Set(['0', 'false', 'off', 'no']);
const REFRESH_MS = 250;
const WINDOW_MS = 2000;

export function hudFromQuery(search) {
  const q = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
  const raw = q.get('hud');
  if (raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  if (ON.has(v)) return true;
  if (OFF.has(v)) return false;
  return false;
}

function fmtMs(n) {
  if (!Number.isFinite(n)) return '--';
  return n < 10 ? n.toFixed(1) : n.toFixed(0);
}

function fmtRate(n) {
  if (!Number.isFinite(n) || n < 0) return '--';
  if (n < 10) return n.toFixed(1);
  return String(Math.round(n));
}

function hostStats(host) {
  if (!host || host.kind !== 'remote') {
    return { dropped: null, fieldDropped: null, frames: null, bytes: null, fieldBytes: null, decodeMs: null, paintMs: null };
  }
  return {
    dropped: host.framesDropped,
    fieldDropped: host.fieldsDropped,
    frames: host.framesReceived,
    bytes: host.bytesReceived,
    fieldBytes: host.fieldBytes,
    decodeMs: host.fieldDecodeMs,
    paintMs: host.fieldPaintMs,
  };
}

export function setupClientPerfHud({ host, getFieldMode, now = () => performance.now() } = {}) {
  const el = typeof document !== 'undefined' && document.getElementById('client_perf_hud');
  if (!el) return { stop() {} };
  el.style.display = 'block';
  const intervals = [];
  let lastRaf = 0;
  let lastDom = 0;
  const snap = () => {
    const st = hostStats(host);
    return { t: now(), frames: st.frames || 0, bytes: st.bytes || 0, fieldBytes: st.fieldBytes || 0 };
  };
  let prev = snap();
  let rafId = 0;
  const tick = (t) => {
    if (lastRaf) {
      intervals.push({ t, dt: t - lastRaf });
      const cut = t - WINDOW_MS;
      while (intervals.length && intervals[0].t < cut) intervals.shift();
    }
    lastRaf = t;
    if (t - lastDom >= REFRESH_MS) {
      lastDom = t;
      render(t);
    }
    rafId = requestAnimationFrame(tick);
  };
  const render = (t) => {
    let rafMs = 0, worst = 0, n = 0;
    for (const it of intervals) {
      rafMs += it.dt;
      if (it.dt > worst) worst = it.dt;
      n++;
    }
    const avg = n ? rafMs / n : 0;
    const fps = avg > 0 ? 1000 / avg : 0;
    const st = hostStats(host);
    const dtS = Math.max(0.2, (t - prev.t) / 1000);
    const frameHz = st.frames != null ? (st.frames - prev.frames) / dtS : 0;
    const kbS = st.bytes != null ? (st.bytes - prev.bytes) / 1024 / dtS : 0;
    const fieldKbS = st.fieldBytes != null ? (st.fieldBytes - prev.fieldBytes) / 1024 / dtS : 0;
    prev = { t, frames: st.frames || 0, bytes: st.bytes || 0, fieldBytes: st.fieldBytes || 0 };
    const mode = getFieldMode ? (getFieldMode() || 'default') : 'default';
    const remote = host && host.kind === 'remote';
    const lines = [
      'mode ' + mode,
      'rAF ' + fmtMs(avg) + ' ms  worst ' + fmtMs(worst) + ' ms  ' + fmtRate(fps) + ' fps',
    ];
    if (remote) {
      lines.push('decode ' + fmtMs(st.decodeMs) + ' ms  paint ' + fmtMs(st.paintMs) + ' ms');
      lines.push('drop frames ' + st.dropped + '  fields ' + st.fieldDropped);
      lines.push('recv ' + fmtRate(frameHz) + ' fps  ' + fmtRate(kbS) + ' KB/s');
      lines.push('vector field ' + fmtRate(fieldKbS) + ' KB/s');
    }
    el.textContent = lines.join('\n');
  };
  rafId = requestAnimationFrame(tick);
  return {
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      el.style.display = 'none';
    },
  };
}
