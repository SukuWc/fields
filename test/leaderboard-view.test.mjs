import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaderboardViewHtml, gapText, penaltyText, legText } from '../src/leaderboard-view.js';
import { boatColorCss } from '../src/boat-colors.js';
import { hudFromState } from '../src/hud.js';

const rows = [
  { position: 1, boat: 1, status: 'racing', label: 'L', leg: 2, legs: 3, kind: 'beat', legM: 42.4, gapM: 0, entry: null },
  { position: 2, boat: 0, status: 'racing', label: 'L', leg: 2, legs: 3, kind: 'beat', legM: 50, gapM: 7.6, entry: null },
  { position: 3, boat: 2, status: 'finished', label: 'Fin', leg: 3, legs: 3, kind: 'run', legM: null, gapM: null, entry: { elapsed: 188.4, unserved: ['31'], dsq: 0, penaltyS: 20 } },
];

test('one row per boat: position, colour chip, name, leg, gap, penalty badge', () => {
  const html = leaderboardViewHtml(rows, { own: 0, pending: [1, 0, 0] });
  assert.equal((html.match(/<li class="lb-row/g) || []).length, 3);
  assert.match(html, new RegExp('background:' + boatColorCss(1)));
  assert.match(html, /<li class="lb-row me pen"><span class="lb-pos">2<\/span>.*?<span class="lb-name">Boat 0<\/span><span class="lb-leg">Leg 2\/3 ↑<\/span><span class="lb-gap">\+8 m<\/span><span class="lb-pen sz-chip">1 pen<\/span>/);
  assert.match(html, /lb-row pen fin.*?Fin 3:08\.4.*?\+20 s/);
  assert.match(html, /<span class="lb-rank sz-chip"[^>]*>2\/3<\/span>/);
  assert.equal(gapText(rows[0]), '42 m');
  assert.equal(penaltyText(rows[2]), '+20 s');
  assert.equal(legText(rows[2]), 'Fin 3:08.4');
});

test('no own boat: no rank chip; boat colours never use the RoW red/green tokens', () => {
  const html = leaderboardViewHtml(rows, { own: null });
  assert.doesNotMatch(html, /lb-rank/);
  assert.doesNotMatch(html, /#e1182b|#18a15e/i);
});

test('hud results use the component; spectator id highlights nothing', () => {
  const h = { lb: rows, b: [{ pending: 0 }, { pending: 0 }, { pending: 0 }] };
  assert.match(hudFromState(h).results, /lb-row me.*?Boat 0/);
  assert.doesNotMatch(hudFromState(h, 'zz', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]).results, /lb-rank| me"/);
  assert.equal(hudFromState({}).results, null);
});
