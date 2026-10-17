<p align="center"><img src="assets/sailzone-logo.svg" alt="SailZone - Race the rules." width="360"></p>

<p align="center"><a href="brand-kit/">brand-kit/</a></p>

<p align="center"><a href="https://sukuwc.github.io/fields/"><b>Play the test build</b></a></p>

# fields

## Roadmap

Last updated: 2026-10-17

### 1. Stabilize
- [x] Fix scenario 1 crash (out-of-bounds read in `get_field_velocity`): [#2](https://github.com/SukuWc/fields/pull/2)
- [x] AMR coupling corrections and one-cell domain shifts: [#3](https://github.com/SukuWc/fields/pull/3)
- [x] Circular disk refinement around the boat: [#4](https://github.com/SukuWc/fields/pull/4)
- [x] Constant-wind dev mode with the fluid sim off (`?devmode=1`): [#2](https://github.com/SukuWc/fields/pull/2)
- [x] WebGL canvas resizes with the window so the page no longer scrolls: [#17](https://github.com/SukuWc/fields/pull/17)
- [x] Guide and hull lines no longer vanish as the camera follows the boat: [#22](https://github.com/SukuWc/fields/pull/22)
- [x] Firefox keeps `?devmode=1` (and other URL settings) across reload: [#25](https://github.com/SukuWc/fields/pull/25)
- [ ] Robust fluid perf test: `performance.now()`, warm-up, median, opt-in ms limit, and a machine-independent cap of about 4500 ghost injections per step (the 12 ms "scenario 0 step stays cheap" check has failed since [#9](https://github.com/SukuWc/fields/pull/9))
- [ ] Faster coarse-to-fine ghost injection: decompose each coarse cell once, reuse scratch buffers, read populations by index (about 77% of the step after [#9](https://github.com/SukuWc/fields/pull/9), which took scenario 0 from about 4.5 ms to about 18 ms per step) (partial: [#32](https://github.com/SukuWc/fields/pull/32) caches coarse-cell decomposition once per inject pass; still open: reuse scratch buffers, read populations by index)
- [ ] Fluid steps fit the 16 ms frame budget again (about 36 ms per frame now at 2 steps per frame)
- [x] Simulation resolution setting (Default / x2 / x4 coarser) for cheaper fluid steps: [#36](https://github.com/SukuWc/fields/pull/36)
- [x] Experimental fast-wind grid modes (2 m cell every frame / 1.2×) and 150 m map: [#40](https://github.com/SukuWc/fields/pull/40)
- [x] Refinement budget: cell updates per root step (curl-threshold controller, `?cellBudget`, 4-boat scenario): [#43](https://github.com/SukuWc/fields/pull/43)
- [x] Configurable map size (50×100, 100×200, 200×400 m): [#44](https://github.com/SukuWc/fields/pull/44)
- [x] Perf overlay: cells per level and field step time: [#26](https://github.com/SukuWc/fields/pull/26)
- [x] Fixed-step sim loop so simulation speed no longer depends on the display refresh rate (replaces the `planck-renderer` Runner; sim/client split, phase 1): [#46](https://github.com/SukuWc/fields/pull/46)
- [x] Sim modules without DOM: FieldPainter, simOptions, boat telemetry (sim/client split, phase 2): [#47](https://github.com/SukuWc/fields/pull/47)
- [x] Fixed 30 FPS: one sim pass per 30 Hz tick, render capped at 30 fps, per-pass boat terms converted, and a 4 m fast-wind default grid (`simRes=4f`): [#48](https://github.com/SukuWc/fields/pull/48)
- [x] Rules state per simulation (sim/client split, phase 3a): [#52](https://github.com/SukuWc/fields/pull/52)
- [x] Sim class: scenarios, race state, commands, snapshot (sim/client split, phase 3b): [#53](https://github.com/SukuWc/fields/pull/53)
- [x] SimHost interface + LocalHost (sim/client split, phase 4a): [#56](https://github.com/SukuWc/fields/pull/56)
- [x] Web Worker sim host by default (`?worker=0` for main thread) with transferred field buffers (sim/client split, phase 4b): [#57](https://github.com/SukuWc/fields/pull/57)
- [x] Node WebSocket sim server + RemoteHost: authoritative 30 Hz rooms, `--lockstep` mode, streamed wind field, `?host=remote` with LocalHost fallback (sim/client split, phase 5a): [#60](https://github.com/SukuWc/fields/pull/60)
- [x] Remote mode: fixed 30 Hz server frame clock, every frame broadcast to every client, frame-driven client with no rAF loop: [#62](https://github.com/SukuWc/fields/pull/62)
- [x] True- and apparent-wind chevrons sit upwind of the boat with tips pointing downwind (fixes a regression that pointed them upwind): [#59](https://github.com/SukuWc/fields/pull/59)
- [ ] Run `npm test` in CI

### 2. Wind and boat feel
- [x] Fluid sim on, stable from wind 5 through 25 with the sail wake on the fine grid: [#9](https://github.com/SukuWc/fields/pull/9)
- [ ] Per-boat wind shadow / dirty air (partial: [#9](https://github.com/SukuWc/fields/pull/9) gives each boat a sail wake, so a downwind boat reads slower true wind)
- [x] Depower toggle (X / touch): sails eased out and luffing with a 0.5 s ramp: [#51](https://github.com/SukuWc/fields/pull/51)
- [ ] Strategy tuning

### 3. Multiplayer open water
- [x] Shared world and shared wind: [#60](https://github.com/SukuWc/fields/pull/60) (server rooms + streamed wind); [#61](https://github.com/SukuWc/fields/pull/61) (Join with my boat: each client owns a named boat, steers only that boat, removed on leave or disconnect)
- [ ] Soft physical collisions (bump and slow)
- [ ] Server-authoritative collisions
- [ ] Reconnect

### 4. Core race loop
- [ ] Course: start line, marks, finish, boundary (partial: [#27](https://github.com/SukuWc/fields/pull/27) adds anchored mark buoy physics and scenario 11; [#28](https://github.com/SukuWc/fields/pull/28) adds anticlockwise triangle course progress, mark rounding, and scenario 12; [#31](https://github.com/SukuWc/fields/pull/31) adds gate marks and windward-leeward scenario 13; [#33](https://github.com/SukuWc/fields/pull/33) adds start line, RRS 26 start sequence, and scenario 14; [#38](https://github.com/SukuWc/fields/pull/38) adds the finish line and scenario 16; [#45](https://github.com/SukuWc/fields/pull/45) adds SailGP-style virtual boundaries, boundary room, crossing penalty, and scenario 19; still open: wider course use of the boundary)
- [x] Finish times and results list: [#38](https://github.com/SukuWc/fields/pull/38)
- [x] Live leaderboard (distance only) and three-boat test race, scenario 17: [#39](https://github.com/SukuWc/fields/pull/39)
- [ ] Equal boats
- [ ] Race states
- [ ] Replay scrub

### 5. Rules engine
- [x] Primitives: overlap, clear ahead/astern: [#6](https://github.com/SukuWc/fields/pull/6)
- [ ] Primitives: keep-clear border, zone, mark-room (partial: [#35](https://github.com/SukuWc/fields/pull/35) adds the 3-length mark zone and mark-room entitlement)
- [x] Rule registry, all-pairs evaluation, resolver: [#11](https://github.com/SukuWc/fields/pull/11)
- [x] Rule 10: [#5](https://github.com/SukuWc/fields/pull/5)
- [x] Rule 11 and Rule 12: [#6](https://github.com/SukuWc/fields/pull/6)
- [x] Rule 13: [#8](https://github.com/SukuWc/fields/pull/8)
- [ ] Rule 14 with real collisions (partial: [#12](https://github.com/SukuWc/fields/pull/12) detects contact)
- [x] Rule 15: [#10](https://github.com/SukuWc/fields/pull/10)
- [ ] Rule 16.1
- [x] Start / OCS and individual recall: [#33](https://github.com/SukuWc/fields/pull/33)
- [ ] Rule 18 (partial: [#35](https://github.com/SukuWc/fields/pull/35) adds Rule 18.1 scope, Rule 18.2 mark-room, and scenario 15; still open: Rules 18.3 and 18.4)
- [x] Boundary room (SailGP-style virtual boundary rule, overrides Rules 10-13, scenario 19): [#45](https://github.com/SukuWc/fields/pull/45)
- [x] Rule 31: [#34](https://github.com/SukuWc/fields/pull/34)
- [ ] Rule 28
- [ ] Penalties and exoneration (partial: [#12](https://github.com/SukuWc/fields/pull/12) assigns fault on contact; [#20](https://github.com/SukuWc/fields/pull/20) adds a pending penalty cleared by a tack and a gybe in a row, or a Q/E autopilot circle; [#35](https://github.com/SukuWc/fields/pull/35) exonerates the mark-room boat under Rule 21; [#38](https://github.com/SukuWc/fields/pull/38) turns penalties still unserved at the finish into a 20 s time penalty, or DSQ; [#45](https://github.com/SukuWc/fields/pull/45) adds a boundary crossing penalty after 1 s outside and exonerates the boundary-room boat)
- [ ] Incident log (partial: [#12](https://github.com/SukuWc/fields/pull/12) stores contact incidents and a FAULT badge)
- [ ] Rule-stack labels (partial: [#12](https://github.com/SukuWc/fields/pull/12) shows the active rule and inhibited rules)

### 6. Closed beta polish
- [ ] Performance (including profiling the render side) (partial: [#42](https://github.com/SukuWc/fields/pull/42) batches `#info` readout writes into one `innerHTML` update, cutting median live DOM nodes from about 28,800 to about 6,000; still open: wider render-side profiling)
- [ ] Crash recovery
- [ ] Spectator mode
- [x] Hamburger settings menu on phones and touch screens: [#29](https://github.com/SukuWc/fields/pull/29)
- [x] Boat 1 touch controls in the bottom half of the screen: [#30](https://github.com/SukuWc/fields/pull/30)
- [x] Touch controls panel 30% shorter (35% of the screen): [#37](https://github.com/SukuWc/fields/pull/37)
- [ ] Accessibility
- [ ] Telemetry export
- [x] Sail flapping animation for luffing sails (visual only): [#54](https://github.com/SukuWc/fields/pull/54)
- [x] Jib downwind shadow flap only while eased (× depower ramp, visual only): [#58](https://github.com/SukuWc/fields/pull/58)

### Other
- [x] SailZone logo: [#14](https://github.com/SukuWc/fields/pull/14)
- [x] SailZone icon-only logo: [#15](https://github.com/SukuWc/fields/pull/15)
- [x] SailZone brand kit: [#18](https://github.com/SukuWc/fields/pull/18)
- [x] URL-synced settings controls: [#7](https://github.com/SukuWc/fields/pull/7)
- [x] Scenario description panel: [#12](https://github.com/SukuWc/fields/pull/12)
- [x] Overlay lines drawn above the wind-field heatmap: [#13](https://github.com/SukuWc/fields/pull/13)
