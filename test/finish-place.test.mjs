// Finish position overlay (finish.js finishPlaceState / finishPlaceGuidesFromState):
// each finished boat shows her place at the stern (where the penalty count
// badge sits), ranked by corrected time (finish + 20 s per unserved penalty),
// updated live as others finish; 1–3 are medals.
import './dom-stub.mjs';
import { RaceResults, finishPlaceState, finishPlaceGuidesFromState, finishPlaceRole, FINISH_UNSERVED_PENALTY_S } from '../src/finish.js';
import { chargePendingPenalty } from '../src/rules.js';
import { SimCore } from '../src/host.js';
import { buildScene } from '../src/scene-build.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };

{
  const course = { finish: null, progressFor: () => ({}) };
  const res = new RaceResults(course);
  const mk = (id) => ({ boatId: id, x: 0, y: 0 });
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map(mk);
  const boats = [a, b, c, d, e];
  chargePendingPenalty(a, { time: 0, rule: '31', kind: 'mark', reason: 'Rule 31: touched gate 2', label: 'Rule 31 · touched gate 2' });
  const places = () => Object.fromEntries(finishPlaceState(res, boats));
  res.record(a, 0, 100);
  check('A finishes first (with a 20 s penalty): place 1', places().a === 1 && res.entryFor(a).corrected === 100 + FINISH_UNSERVED_PENALTY_S, JSON.stringify(places()));
  res.record(b, 1, 110);
  check('B finishes 10 s later, clean: B 1, A 2 (live)', places().b === 1 && places().a === 2, JSON.stringify(places()));
  res.record(c, 2, 125);
  res.record(d, 3, 130);
  check('A (120 corrected) still ahead of C (125)', places().a === 2 && places().c === 3 && places().d === 4, JSON.stringify(places()));
  check('unfinished boats have no place', !('e' in places()));
  check('boats no longer in the race are left out', finishPlaceState(res, [a, b]).length === 2);
  const view = boats.map((q, i) => ({ id: q.boatId, x: i * 10, y: 0, ha: 0 }));
  const g = finishPlaceGuidesFromState(finishPlaceState(res, boats), view);
  const by = Object.fromEntries(g.map((x) => [x.lines[0].role, x]));
  check('medals for 1–3, a numbered badge for 4', g.length === 4 && by.medal1 && by.medal2 && by.medal3 && by.place && by.place.lines[0].text === '4', JSON.stringify(g.map((x) => x.lines[0])));
  check('at the stern like the penalty badge (2.5 m behind, heading 0 → +y)', by.place.x === 30 && Math.abs(by.place.y - 2.5) < 1e-9 && by.place.badge === true, `${by.place.x}, ${by.place.y}`);
  check('roles', finishPlaceRole(1) === 'medal1' && finishPlaceRole(3) === 'medal3' && finishPlaceRole(4) === 'place' && finishPlaceRole(0) === 'place');
  const dsq = new RaceResults(course, { mode: 'dsq' });
  const f = mk('f');
  chargePendingPenalty(f, { time: 0, rule: '31', kind: 'mark', reason: 'Rule 31: touched gate 2', label: 'Rule 31 · touched gate 2' });
  dsq.record(f, 0, 50);
  const gd = finishPlaceGuidesFromState(finishPlaceState(dsq, [f]), [{ id: 'f', x: 0, y: 0, ha: 0 }]);
  check('DSQ mode: a "DSQ" badge instead of a place', gd.length === 1 && gd[0].lines[0].text === 'DSQ' && gd[0].lines[0].role === 'place');
}

// Frame state and the built scene.
{
  const core = new SimCore({ mapW: 100, mapH: 200, simRes: '2f' });
  mute(() => core.command({ type: 'restart', scenario: 16 }));
  const tick = () => mute(() => core.tick({ dt: 1 / 30, held: [], present: true, view: {} }));
  let fr = tick();
  check('no finishers: no state.fp', fr.state.fp === undefined);
  const sim = core.sim;
  sim.raceResults.record(sim.players[1], 1, 5);
  fr = tick();
  check('state.fp after a finish', JSON.stringify(fr.state.fp) === JSON.stringify([[sim.players[1].boatId, 1]]), JSON.stringify(fr.state.fp));
  const scene = buildScene(fr.state, core.statics, null);
  const lab = scene.guides.filter((x) => x.type === 'label' && x.lines[0].id === 'place');
  check('scene: one medal label at the finisher', lab.length === 1 && lab[0].lines[0].role === 'medal1');
  check('no old "Finished P1" label over the boat', !scene.guides.some((x) => x.type === 'label' && (x.lines[0].id === 'fin' || /^Finished/.test(x.lines[0].text))) && JSON.stringify(Object.keys(fr.state.finish)) === '["next"]');
  mute(() => core.command({ type: 'restart', scenario: 16 }));
  fr = tick();
  check('new race: places gone', fr.state.fp === undefined);
}

if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all finish place checks passed');
