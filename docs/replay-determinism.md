# Replay determinism spike (milestones 1 and 2)

Plan: a past race is stored as the room seed, the room config and the
tick-stamped player commands, and the viewer's browser re-simulates it. That
only works if the sim gives bit-identical results everywhere: on the server
(Node) and in every browser engine. This spike measures that.

## What was run

`scripts/determinism/harness.mjs` builds the multiplayer room default the way
`apps/server/room.js` applies a config: `defaultRoomConfig()` (custom race
course, 100 × 200 m, gusts on at 10/min), `wind_schedule = true` with a fixed
`wind_schedule_seed = [424242, 0]`, gusts reseeded from the room seed, then
the custom course restart. Three boats are spawned at tick 1 and driven by a
scripted, tick-stamped command log through the real command path
(`SimCore.command` → `Sim.command` for spawn, tack, autopilot toggles,
penalty turn and depower; held `helm` / `headingTarget` keys through
`SimCore.tick`, as the server's held-key union does). Each tick is one fixed
step of `FixedStepLoop`'s dt (1/30 s), with the scene frame built as on the
server.

After every tick `src/state-hash.js` hashes the state by IEEE-754 bits (64-bit,
two 32-bit lanes):

- **field**: all 9 populations, ρ, ux, uy of every root cell and every
  refinement-domain cell (recursively), plus the domain bounds;
- **boats**: planck position, angle and velocities, plus every primitive field
  of each `Boat` (rudder, autopilot PID state, sails, heel, telemetry, …);
- **wind**: applied and base wind, schedule clock, gust columns;
- **race**: sim tick and rules time, marks, course progress, start sequence,
  leaderboard, finish results and per-boat rule records.

`Boat.uid` is left out: it comes from a process-wide counter (`boat.js`
`_nextBoatUid`), so it differs between two cores in one process. It is an
identity only (spawned boats are addressed by `spawnId`), but a replay must not
address scenario boats by `uid`.

## Milestone 1: same machine — PASS

`test/replay-determinism.test.mjs` (runs in CI with `npm test`, 150 ticks,
about 4 s per run) runs the harness twice in one process and once in a
separate Node process. Every tick's hash matches. Longer: `REPLAY_TICKS=18000
node --test --import ./test/register.mjs test/replay-determinism.test.mjs`.

Nothing in the sim path depends on wall time or `Math.random`:
`performance.now()` in `sim.js` / `boltzmann.js` only feeds the perf counters,
`rules.js` / `mark-touch.js` use it for flash animations, and the only
`Math.random` is `drawWindSeed` (the room seed itself, which the replay stores).

## Milestone 2: across engines — FAIL as-is, PASS with deterministic math

`npm run determinism:browsers` (Playwright; `npx playwright install chromium
firefox webkit` once) runs Node and the three browsers in parallel on the same
harness bundle (esbuild) and compares every tick's hash with Node. WebKit is
our stand-in for iOS Safari (JavaScriptCore); see the caveat below.

Engines: Node v24.22.1 (V8 13.6.233.17), Chromium 159.0.8154.6, Firefox 159.0,
WebKit 27.2 (Playwright 1.65.1), Linux x64.

| Run | Node | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| Native `Math`, 1 800 ticks | reference | diverges at tick 2 (field, boats, race) | diverges at tick 2 (boats) | diverges at tick 2 (field, boats, race) |
| Deterministic math without `pow` | reference | matches | diverges at tick 6 (boats: rudder angle, `Math.pow(…, N)` with integer N in `boat.js`) | same as Firefox |
| Deterministic math with `pow`, before the `x ** 4` fix | reference | matches | diverges at tick 129 (boats: one boat's angular velocity, from `x ** 4` in `dinghy-forces.js`) | same as Firefox |
| **Deterministic math + `x ** 4` fix, 18 000 ticks (10 min)** | reference | **all 18 000 match** | **all 18 000 match** | **all 18 000 match** |

Tick 1 has no boats and matches everywhere; the first divergence is in the
first boat step (tick 2). Chromium and WebKit agree with each other there and
differ from Node in the last bit of the hull angle (-2.356194490192345 vs
-2.3561944901923453); Firefox differs elsewhere (sail normal force). The
boats' sail momentum then carries the difference into the field in the same
tick.

How big it gets with native math (same run, boat position gap to Node and the
largest root-cell velocity gap):

| After | Boat gap | Field velocity gap |
|---|---|---|
| 30 s | ~1e-13 m | 0.000 % of max speed |
| 2 min | ~2e-12 m | 0.000 % |
| 10 min | 5–16 mm | 4–6 % of max speed (Chromium 4.0, Firefox 5.9, WebKit 4.6) |

The gap grows about ten orders of magnitude in eight minutes. That is
exponential: the flow amplifies it. A longer race, boat-to-boat contact or a
decision on a threshold (a mark rounding, a rule call, a gust spawn) will
make it visible.

### Causes

`scripts/determinism/math-probe.mjs` compares each `Math` function on 200 000
seeded inputs with this Node (share of the first 4 000 that differ):

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| sin / cos | 3 % | 1 % | 3 % |
| tan | 4 % | same | 4 % |
| atan / atan2 | 6 % / 18 % | same | 6 % / 18 % |
| acos | 8 % | same | 8 % |
| exp | 9 % | same | 9 % |
| log / log2 / log10 | 3 % / 0.3 % / 7 % | same / same / 7 % | 3 % / 0.3 % / 1 % |
| pow (non-integer y), `x ** 2`, `x ** 0.5`, sqrt | same | same | same |
| `x ** 3` / `x ** 4` | same | 25 % / 46 % | 25 % / 46 % |
| hypot | same | 36 % | 34 % |
| cbrt | 8 % | same | 43 % |

Even Chromium's V8 differs from Node's V8: the libm changed between V8
versions, so **upgrading Node on the server changes results too**. Firefox
and WebKit compute an integer power by repeated multiplication. V8 does not.

Transcendental calls in the sim path (`Math.*(` per file):

| File | sin | cos | atan2 | acos | exp | log | log10 | log2 | pow | hypot | sqrt |
|---|---|---|---|---|---|---|---|---|---|---|---|
| sim.js | 1 | 1 | | | | | | | | 1 | 1 |
| boltzmann.js | 5 | 5 | | | | | | | | 2 | 2 |
| boat.js | 5 | 6 | 3 | | | | | | 3 | 3 | 3 |
| wind.js | 5 | 5 | 1 | | | | | | | 2 | 1 |
| gusts.js | 3 | 6 | | | 2 | 1 | | | | 1 | 1 |
| wind-schedule.js | 3 | 1 | | | | 1 | | | | | 1 |
| course.js | 8 | 6 | 1 | | | | | | | 7 | 1 |
| start.js | 2 | 1 | | | | | | | | 2 | |
| finish.js | 1 | | | | | | | | | 1 | |
| rules.js | 7 | 7 | | | | | | | | 11 | |
| mark.js / mark-touch.js | 2 | 2 | | | | | | | | 4 | |
| race-bot.js | 3 | 3 | 2 | | | | | | | 2 | |
| leaderboard.js | 1 | 2 | | 1 | | | | | | 1 | |
| heel.js | 3 | 4 | | | | | | | | | |
| foil.js | | | 1 | | | | | | | 1 | |
| dinghy-forces.js | 4 | 4 | 1 | | 1 | | 1 | | | | 3 |
| rudder-limit.js | | | | | | | | | | 1 | |
| domainTrack.js | | | | | | | | 1 | | | |
| vector-field.js | 1 | 1 | 1 | | | | | | 1 | 1 | |
| custom-scenario.js | | | | | | | | | | 3 | |
| scenarios.js | 11 | 11 | | | | | | | | | |
| utils.js | 1 | 1 | 1 | | | | | | | | |

planck-js reads `Math` through its own `Object.create(Math)` object and
calls `sin`, `cos` and `atan2` there (`Rot.setAngle` / `getAngle`) plus
`pow(x, 2)` for two constants. The `**` operator in the sim path is `x ** 2`
(exact everywhere), `2 ** n` (exact) and one `x ** 4` in `dinghy-forces.js`
`residuaryDragArea` (now `x2 * x2`). The lattice step itself (collide /
stream / bounce) is plain arithmetic and is deterministic.

### Fix: deterministic math in the sim path

`src/det-math.js` ports the fdlibm functions to pure JS: sin, cos, tan, atan,
atan2, asin, acos, exp, log, log10, log2 and pow, plus a scaled hypot. They
use only `+ − × ÷` and `Math.sqrt`, all correctly rounded in IEEE-754, so
every engine returns the same bits. sin, cos, atan, atan2, asin, acos, exp,
log, log10 and hypot match Node's own bit for bit. pow is within 1 ulp, and
tan and log2 within 2 ulp (`test/det-math.test.mjs`).

Sim code (server and client) calls them as `DMath.sin(…)` etc. instead of
`Math.sin(…)`, and `2 ** k` became `DMath.pow(2, k)` (exact for every
integer k). `src/planck-det.js`, loaded by `map.js`, gives planck's private
`Math` object the same functions; the global `Math` is never patched, so
rendering code keeps the native functions. `test/det-math-guard.test.mjs`
fails when a sim-path file (everything the server bundle or the headless
harness imports, minus a short display-only list) calls a built-in
transcendental `Math.*` function or uses `x ** n` with n ≠ 2, and when a new
file joins that import graph without being classified.

Cost: none measurable. 1 800 ticks, hashing only at the end, all four engines
in parallel, `main` and this branch run back to back:

| ms/tick | Node | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| Native `Math` (main) | 16.9 | 14.8 | 16.2 | 9.1 |
| `DMath` | 16.3 | 14.8 | 16.0 | 9.3 |

With native `Math` all three browsers diverge from Node; with `DMath` all four
end on the same hash. The 10-minute run (18 000 ticks, a hash on every tick)
is bit-identical in Node, Chromium, Firefox and WebKit.

### Caveats

- WebKit here is Playwright's Linux build. JSC calls the platform libm, so
  native math on a real iPhone (Apple libm) may differ again. With the
  deterministic math nothing calls the platform libm, so the result should
  hold, but it has not been run on a device.
- x64 only. IEEE basic operations are identical on ARM64, and JS engines do
  not fuse multiply-adds, but this was not measured.
- The guard test only sees direct `Math.<fn>(` calls and `**`. Aliasing
  (`const { sin } = Math`) or a new dependency with its own transcendental
  calls would slip past it; the browser check would catch the divergence.

## Recommendation

**Seed + inputs only is viable, but only with deterministic math.** With
native `Math` the engines (and Node versions) disagree from the first boat
step, and the gap grows exponentially. It reaches millimetres and several
percent of the local flow within one 10-minute race. With the fdlibm ports and
the `**` fix, Node, Chromium, Firefox and WebKit stay bit-identical for 10
minutes at no measurable cost.

Before milestone 3:

1. Done: the sim path uses `src/det-math.js` (see above).
2. Store the build version with each race and keep its bundle (deterministic
   math also makes results independent of the server's Node version).
3. Still record a cheap state hash every N ticks (for example every 30 ticks,
   16 hex characters each) in the race log. A replay can then report the
   first tick where it desyncs instead of silently drifting. Keep periodic
   snapshots as the plan for seeking (milestone 6), not for correctness.
4. Run the browser check on a real iPhone (Safari) and an ARM Mac before
   relying on it.

## Recording races (in memory)

`apps/server/replays.js` records every race a server room runs, in RAM only
(a module-level ring buffer: the last three finished races of the whole
server; a Node restart forgets them).

- **Race start**: a fresh SimCore. A room builds one when it is created, and
  `Room.newRace()` (time limit, finish countdown, restart vote) now builds a
  new core too (`Room._freshCore`, as a map resize already did) before it
  re-applies the room TOML, so every race replays from a known start.
  Player boats are kept as before; the spawn id counter carries over.
- **Race end**: the next race start (`timeLimit`, `finished`, `vote`,
  `resize`, `join`), the room being dropped (`closed`), 60 s with no player
  boat on the water (`idle`; the next boat to join starts a new race), or
  2 h of sim time (`truncated`). A race no player boat joined is not kept.
- **Record**: room, build version (`/api/version` sha, else
  `SOURCE_COMMIT` / `COMMIT_SHA` / `GIT_COMMIT` / `GIT_SHA`, else the
  package version), SimCore constructor options, start time, every
  top-level `SimCore.command` stamped with the number of ticks done (room
  config applies expanded into their commands with the drawn seed, restarts,
  spawn / remove, per-player Dev gains and rudder limits, autopilot, tack,
  penalty turns, ...), the tick inputs whenever they change (held helm /
  heading commands, dt, view), a state hash every 30 ticks (about 1 ms per
  hash on the default room) and at the end, the room TOML and seed, and the
  finish results.
- `resimulate(record)` re-runs a record on a fresh SimCore and reports the
  first hash that differs; `test/replay-recorder.test.mjs` checks a recorded
  race reproduces its hashes and results, and that the list keeps three.

`GET /api/replays` lists them (no logs), `GET /api/replays/:id` returns one
record. There is no player UI yet.

## Running it

```bash
npm test                                   # milestone 1 (150 ticks) + det-math checks + sim-path guard
REPLAY_TICKS=1800 node --test --import ./test/register.mjs test/replay-determinism.test.mjs
npx playwright install chromium firefox webkit                     # once
npm run determinism:browsers -- --ticks 1800                       # quick check, all engines
npm run determinism:browsers -- --ticks 18000                      # 10 min, hash every tick
node scripts/determinism/math-probe.mjs    # per-function engine differences
```

`determinism:browsers` writes `node.json`, `<engine>.json` and `summary.json`
to `$TMPDIR/fields-determinism` (or `--out dir`) and exits 1 if any engine
diverges. It is not in CI: it needs the Playwright browsers.
