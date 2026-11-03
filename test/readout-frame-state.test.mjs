// Instrument readout fields on frame state.boats[i] (boat.js renderState,
// scene-state.js): aws_ms / tws_ms in m/s, heading_deg / twd_deg compass
// bearings 0–360, next_mark_dist_m / to_finish_m from the leaderboard, and a
// remote-mode round trip through roundJson + the binary wire codec.
import { SimCore } from '../src/host.js';
import { roundJson } from '../apps/server/room.js';
import { encodeWire, decodeWire } from '../src/wire-codec.js';
import { headingBearing, windFromBearing } from '../src/boat.js';
import { WIND_UNIT_MPS } from '../src/wind.js';

let failed = 0;
function check(name, ok, info = '') {
  if (!ok) failed++;
  console.info(`${ok ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
}
const log = console.log;
const mute = (fn) => { console.log = () => {}; try { return fn(); } finally { console.log = log; } };
const view = { camera_position_x: 0, camera_position_y: 0, camera_zoom: 20, show_forces: false, show_fields: false };

// Bearing conventions.
check('bow on local -Y at ha=0 points south (180)', headingBearing(0) === 180);
check('ha=90° points east... bearing 90', Math.abs(headingBearing(Math.PI / 2) - 90) < 1e-9);
check('wind from math 90° (+Y) is from north (0)', windFromBearing(90) === 0);
check('wind from math 0° (+X) is from east (90)', windFromBearing(0) === 90);

for (const n of [0, 16]) {
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '4f', texture: undefined });
  mute(() => core.command({ type: 'restart', scenario: n }));
  let twsOk = true, bearOk = true, unitOk = true, distOk = true, distSeen = 0, rtOk = true;
  mute(() => {
    for (let t = 0; t < 200; t++) {
      const f = core.tick({ dt: 1 / 30, held: t % 40 < 10 ? [{ type: 'helm', boat: 0, dir: 1 }] : [], present: true, view });
      if (!f.state) continue;
      const players = core.sim.players;
      f.state.boats.forEach((b, i) => {
        if (!Number.isFinite(b.tws_ms) || b.tws_ms < 0) twsOk = false;
        for (const k of ['heading_deg', 'twd_deg']) if (!(b[k] >= 0 && b[k] < 360)) bearOk = false;
        const p = players[i];
        if (Number.isFinite(b.aws_ms) && Math.abs(b.aws_ms - p._aws * WIND_UNIT_MPS) > 1e-9) unitOk = false;
        if (Math.abs(b.tws_ms - p.wind_speed * WIND_UNIT_MPS) > 1e-9) unitOk = false;
        const st = core.sim.leaderboard && core.sim.leaderboard.states.get(p);
        if (st) {
          distSeen++;
          const want = Number.isFinite(st.legM) ? st.legM : null;
          if (b.next_mark_dist_m !== want) distOk = false;
          if (b.to_finish_m !== (Number.isFinite(st.toFinishM) ? st.toFinishM : null)) distOk = false;
        }
      });
      if (t % 20 === 0) {
        const m = { type: 'frame', frame: { state: { boats: f.state.boats } } };
        const d = decodeWire(encodeWire(m));
        const j = JSON.parse(roundJson(m));
        for (let i = 0; i < f.state.boats.length; i++) for (const k of ['aws_ms', 'tws_ms', 'heading_deg', 'twd_deg', 'next_mark_dist_m', 'to_finish_m']) {
          const a = d.frame.state.boats[i][k], e = f.state.boats[i][k], r = j.frame.state.boats[i][k];
          if (a !== r) rtOk = false;
          if (e != null && Number.isFinite(e) && Math.abs(a - e) > 1e-3) rtOk = false;
        }
      }
    }
  });
  check(`scenario ${n}: tws_ms present and finite on every frame`, twsOk);
  check(`scenario ${n}: heading_deg / twd_deg in [0, 360)`, bearOk);
  check(`scenario ${n}: aws_ms / tws_ms = internal × WIND_UNIT_MPS`, unitOk);
  if (n === 16) check(`scenario ${n}: next_mark_dist_m equals the leaderboard legM`, distOk && distSeen > 0, `${distSeen} samples`);
  check(`scenario ${n}: readout fields survive the remote wire round trip`, rtOk);
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
