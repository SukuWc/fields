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
  hash on the default room) and at the end, the room TOML and seed, the
  finish results, and the race's chat (`chat`: every line the room posted
  during the race, player messages and system lines such as joins, the room
  seed and the vote, as `{ t (race tick), seq, at, rc?, text, sys?, from? }`;
  kept apart from the sim log and not hashed). `GET /api/replays` entries
  carry `bytes`, the UTF-8 size of the record's JSON.
- `resimulate(record)` re-runs a record on a fresh SimCore and reports the
  first hash that differs (the stepping is `src/replay-stepper.js`, shared
  with the browser player below); `test/replay-recorder.test.mjs` checks a recorded
  race reproduces its hashes and results, and that the list keeps three.

`GET /api/replays` lists them (no logs), `GET /api/replays/:id` returns one
record.

## Browser replay player (basic)

The landing page lists, under each room card, that room's last (up to
three) recorded races (`Replay 11:50 · 66 s · suku`, start time in the
viewer's time zone). A link opens the game page at `/play/?replay=<id>`:
`src/replay-host.js` (`ReplayHost`, a SimHost like LocalHost) fetches
`/api/replays/<id>`, builds a SimCore on the main thread from the record's
start options and steps it one recorded tick per 30 Hz page tick with
`ReplayStepper` (`src/replay-stepper.js`), the same code the server's
`resimulate()` runs. The normal game view draws it; the camera follows the
first player boat. The page's keys, view and commands are ignored (only the
field colours pass), so nothing on the page can change the race. The
recorded `present` flag is replayed as recorded: it changes the state hash
(scene state building touches sim state), while the view does not.

A banner shows the position, `hashes OK n/66`, or `MISMATCH at tick N (want,
got)` at the first stored hash that differs, then `Replay finished`; Pause /
Play and a link back to the rooms. The recorded chat appears in the normal
chat panel when the replay reaches each line's tick (live chat events from
the ReplayHost, so Pause holds them too); the chat input stays disabled.
Older records without `chat` play as before. The landing links show start
time, race length (m:ss) and record size in bytes. A slow device plays slower than real time (the loop drops time, never
ticks); seeking and speed are in the worker section below.

`node scripts/replay-player-browser.mjs [--engine chromium|firefox|webkit]`
(after `npm run build:app && npm run build:server`) serves the recorded live
race `test/fixtures/replay-europe-1-mww066n9-1.json` to the browser, follows
the landing link and waits for `66/66 hashes OK`.

## Sim snapshots (for seeking)

`SimCore.snapshot()` returns an in-memory copy of the whole sim state
(lattice and every refinement level, map and planck world, Sim with boats,
course, rules, gusts, wind schedule and race, room settings);
`core.restore(snapshot)` makes the core continue from it, and the same
snapshot can be restored any number of times. `ReplayStepper.snapshot()` /
`restore()` add the stepping cursor, so a replay restored at tick t steps on
to the recorded hashes. The copy is `src/sim-snapshot.js` `deepCopy`
(prototypes, shared references and cycles, typed arrays, Map / Set, hidden
fields, key order). It is not a file format: a snapshot is valid only for the
build that made it, and none is stored in a record.

What it took (found in the seek spike, 2026-11-25):

- State a copy cannot see moved into the sim objects: the gust random
  generator (`gusts.js` `Mulberry32`, state on a plain object instead of a
  closure); the true-wind speed derivative (`boat._speedAcc`, was a
  module-level WeakMap in `wind.js`); each boat's refinement window and the
  lattice's field-island holds (`boat._amrDomain`, `bm._trackState`, were
  module-level WeakMaps in `domainTrack.js`); the rules engine's boat ids
  (`boat._ruleId`); course progress is a Map. The new fields are
  non-enumerable, so frames and boat hashes do not see them.
- planck-js keeps three things in functions: `World.addPair` and
  `BroadPhase.queryCallback` are bound and the dynamic tree's node pool is a
  closure; they are rebuilt on the copy, found by shape. Nothing matches
  constructor or function names: esbuild renames them in the browser bundle
  (`World` → `World2`).
- Copies must keep V8 fast properties: filling an empty object through
  computed keys made every lattice cell a dictionary-mode object and the sim
  ran about five times slower on the copies (and slower on fresh cores in the
  same process). `deepCopy` compiles one copier per (prototype, key list)
  with named stores and swaps references in a last pass; a restored race
  steps about 15 % slower than a fresh one in Node.
- Hash version 2 (`hashVersion: 2` in new records, `src/state-hash.js`)
  leaves out the drawing-only boat fields `Boat.renderState()` advances when a
  frame is presented (boom smoothing, sail flap), so a replay can skip
  presenting while it fast-forwards (`step({ draw: false })`, about 10 %
  faster). Records without `hashVersion` (version 1, such as the live
  fixture) keep presenting as recorded and still verify.

Cost (live fixture, 1 boat, about 14 500 cells): snapshot 55–130 ms,
restore 65–140 ms in Node, Chromium, Firefox and WebKit; about 10 MB of heap
each (about 40 MB with six boats). `test/sim-snapshot.test.mjs` restores at
ticks 1, 450, 1200 and 1500 and checks every recorded hash after each;
`npm run determinism:browsers -- --restore` does the same in Chromium,
Firefox and WebKit.

## Replay in a Web Worker (keyframes)

The replay sim no longer runs on the page. `ReplayHost` (`src/replay-host.js`)
is an async proxy over `src/replay.worker.js`, which runs
`src/replay-worker-core.js` around a `ReplayEngine` (`src/replay-engine.js`).
The page sends one `tick` message per 30 Hz page tick (at most two in flight)
and draws the frame the worker answers; chat lines, statuses and the end come
back as messages. `?worker=0` (or a browser without `Worker`) runs the same
core on the page.

- Keyframes: a `ReplayStepper.snapshot()` every 300 ticks (10 s of race
  time), both while playing and from an optional look-ahead scan (a second
  stepper without a painter, run in short slices between ticks; `?replayScan=0`
  turns it off). They stay within a memory budget (default 160 MB, estimated
  at about 700 bytes per lattice cell per keyframe; `?replayMem=<MB>`): over
  budget, every other keyframe goes (t = 0 stays) and the spacing doubles.
- Seek: restore the latest keyframe at or before the target, or the scan's
  current position, or keep stepping from where playback is, whichever is
  closest; then fast-forward in 30 ms slices without drawing (version 2
  records also skip presenting). The worker posts progress (`from`, `to`,
  `t`) at least every 250 ms, answers page ticks with no frame while seeking,
  and `cancelSeek` stops at the tick reached. Recorded hashes are checked on
  every tick of a seek, a scan and playback, so a mismatch is reported at the
  same tick as without seeking. After a jump the host replaces the chat with
  the lines up to the new position (`chatHistory`).
- Speed 1x / 2x / 4x: 2 or 4 recorded ticks per page tick, presenting the
  last only.

Live fixture, Chromium, built app: playing at tick 303 the scan had reached
1099 (keyframes 0-900); a seek to 1500 took 5.5 s, back to 450 took 1.3 s.
A replay plays slower than real time on a slow device, and a six-boat race
can play slower than real time anywhere; seeking ahead of the scan is about
as fast as the sim steps.

## Running it

```bash
npm test                                   # milestone 1 (150 ticks) + det-math checks + sim-path guard
REPLAY_TICKS=1800 node --test --import ./test/register.mjs test/replay-determinism.test.mjs
npx playwright install chromium firefox webkit                     # once
npm run determinism:browsers -- --ticks 1800                       # quick check, all engines
npm run determinism:browsers -- --ticks 18000                      # 10 min, hash every tick
npm run determinism:browsers -- --restore                          # snapshot / restore in every engine
node scripts/replay-player-browser.mjs --engine webkit                # replay page plays a live record
node scripts/determinism/math-probe.mjs    # per-function engine differences
```

`determinism:browsers` writes `node.json`, `<engine>.json` and `summary.json`
to `$TMPDIR/fields-determinism` (or `--out dir`) and exits 1 if any engine
diverges. It is not in CI: it needs the Playwright browsers.
