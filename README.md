<p align="center"><img src="assets/sailzone-logo.svg" alt="SailZone - Race the rules." width="360"></p>

<p align="center"><a href="brand-kit/">brand-kit/</a></p>

<p align="center"><a href="https://sukuwc.github.io/fields/"><b>Play the test build</b></a></p>

# fields

## Roadmap

Last updated: 2026-10-20

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
- [x] Perf panel: per-level share of cell updates vs time, plus field / track / other ms per tick: [#72](https://github.com/SukuWc/fields/pull/72)
- [x] Fixed-step sim loop so simulation speed no longer depends on the display refresh rate (replaces the `planck-renderer` Runner; sim/client split, phase 1): [#46](https://github.com/SukuWc/fields/pull/46)
- [x] Sim modules without DOM: FieldPainter, simOptions, boat telemetry (sim/client split, phase 2): [#47](https://github.com/SukuWc/fields/pull/47)
- [x] Fixed 30 FPS: one sim pass per 30 Hz tick, render capped at 30 fps, per-pass boat terms converted, and a 4 m fast-wind default grid (`simRes=4f`): [#48](https://github.com/SukuWc/fields/pull/48)
- [x] Rules state per simulation (sim/client split, phase 3a): [#52](https://github.com/SukuWc/fields/pull/52)
- [x] Sim class: scenarios, race state, commands, snapshot (sim/client split, phase 3b): [#53](https://github.com/SukuWc/fields/pull/53)
- [x] SimHost interface + LocalHost (sim/client split, phase 4a): [#56](https://github.com/SukuWc/fields/pull/56)
- [x] Web Worker sim host by default (`?worker=0` for main thread) with transferred field buffers (sim/client split, phase 4b): [#57](https://github.com/SukuWc/fields/pull/57)
- [x] Node WebSocket sim server + RemoteHost: authoritative 30 Hz rooms, `--lockstep` mode, streamed wind field, `?host=remote` with LocalHost fallback (sim/client split, phase 5a): [#60](https://github.com/SukuWc/fields/pull/60)
- [x] Remote mode: fixed 30 Hz server frame clock, every frame broadcast to every client, frame-driven client with no rAF loop: [#62](https://github.com/SukuWc/fields/pull/62)
- [x] Server field streaming: per-level 1-byte grids coloured on the client, sent only to clients showing the field: [#64](https://github.com/SukuWc/fields/pull/64)
- [x] Compact JSON server frames: host sends scene state (statics only on change), client builds all geometry, about 1.8 KB per frame in scenario 0 instead of about 40 KB: [#66](https://github.com/SukuWc/fields/pull/66)
- [x] Client builds the readout/HUD panels and encounter overlays from compact JSON state (follow-up to #66, about 18% fewer bytes per frame in the four-boat scenario): [#70](https://github.com/SukuWc/fields/pull/70)
- [x] True- and apparent-wind chevrons sit upwind of the boat with tips pointing downwind (fixes a regression that pointed them upwind): [#59](https://github.com/SukuWc/fields/pull/59)
- [x] Run `npm test` in CI (test + server smoke workflow in `.github/workflows/test.yml`): [#63](https://github.com/SukuWc/fields/pull/63)
- [x] Default fluid grid `simRes=2f` (2 m root, 1 step per tick, about 15.6 ms field time per tick with one boat vs about 47 ms on 4f), wind clamped to each mode's stable ceiling (15 m/s on 2f), and the `2f34` mode removed: [#77](https://github.com/SukuWc/fields/pull/77)
- [x] Settings registry: one list of every setting (scope, type, default, validation, room command) read by the settings panel, URL sync and the server: [#79](https://github.com/SukuWc/fields/pull/79)
- [x] Rule data: sim sends rule codes and boat indices, every client writes the rule text and builds the overlay geometry (sim/client split; about 4.7% fewer bytes per frame in scenario 18): [#82](https://github.com/SukuWc/fields/pull/82)

### 2. Wind and boat feel
- [x] Fluid sim on, stable from wind 5 through 25 with the sail wake on the fine grid: [#9](https://github.com/SukuWc/fields/pull/9)
- [ ] Per-boat wind shadow / dirty air (partial: [#9](https://github.com/SukuWc/fields/pull/9) gives each boat a sail wake, so a downwind boat reads slower true wind)
- [x] Depower toggle (X / touch): sails eased out and luffing with a 0.5 s ramp: [#51](https://github.com/SukuWc/fields/pull/51)
- [x] Near-matched viscosity on the default 4 m fast-wind grid (`simRes=4f`) so sail wakes match the 1 m and x4 grids: [#65](https://github.com/SukuWc/fields/pull/65)
- [x] Wind speed in true m/s everywhere (UI, sim, telemetry, scenarios) with perturbation propagation tests: [#67](https://github.com/SukuWc/fields/pull/67)
- [x] 45° and 22.5° wind propagation tests, root-grid wind read fixed by half a cell (no more 2 m wind jump at refinement edges on 4f), node-based vortex centroid: [#69](https://github.com/SukuWc/fields/pull/69)
- [x] Wind flow tracers replace the per-boat wind-arrow grid: particles carried by the local wind with fading tails, denser where wind is stronger, drawn over the colour field plot, live count/life/tail inputs (`?tracers`, `?tracerLife`, `?tracerTail`): [#68](https://github.com/SukuWc/fields/pull/68)
- [x] Wind-sweep check (3 to 15 m/s on 2f, 400 m map) and harness edge gap, so a boat pinned on the map edge is no longer mistaken for a high-wind stall: [#83](https://github.com/SukuWc/fields/pull/83)
- [ ] Strategy tuning
- [ ] Strong-wind speed cap (heel limit): boat speed keeps climbing with wind (about 0.72× wind speed at 15 m/s) because the sail model has no heel or depower limit; real boats level off. Sweep data in [#83](https://github.com/SukuWc/fields/pull/83) (backlog, not started)

### 3. Multiplayer open water
- [x] Shared world and shared wind: [#60](https://github.com/SukuWc/fields/pull/60) (server rooms + streamed wind); [#61](https://github.com/SukuWc/fields/pull/61) (Join with my boat: each client owns a named boat, steers only that boat, removed on leave or disconnect)
- [x] Room settings panel (room-wide, validated), own-boat-only controls (spectators steer nothing, 1 boat per client, 8 per room), per-client readouts and flow/perf subscriptions, joining never resets the room: [#73](https://github.com/SukuWc/fields/pull/73)
- [ ] Soft physical collisions (bump and slow)
- [ ] Server-authoritative collisions
- [x] Reconnect: boats kept for a 10 s grace period (`--grace-s`) with a countdown for others, auto-reconnect with backoff, connection banner: [#75](https://github.com/SukuWc/fields/pull/75)

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
- [x] Boat trails: fading dot per boat every 1 s of sim time in the boat's colour, live interval/duration/size settings (`?boat_trails`, `?trailInterval`, `?trailDuration`, `?trailSize`, visual only): [#71](https://github.com/SukuWc/fields/pull/71)
- [x] Ghost boat: predicted hull outline 2 s ahead on a constant turn-rate arc, off by default (`?ghost`, `?ghostAhead`, visual only): [#74](https://github.com/SukuWc/fields/pull/74)
- [x] Ghost boat follow-up: ghost hulls matched by boat id, hull shapes sent once in `statics.hulls`, per-boat frame data trimmed to id and rounded velocities (works in local, worker and remote hosts): [#81](https://github.com/SukuWc/fields/pull/81)

### Other
- [x] SailZone logo: [#14](https://github.com/SukuWc/fields/pull/14)
- [x] SailZone icon-only logo: [#15](https://github.com/SukuWc/fields/pull/15)
- [x] SailZone brand kit: [#18](https://github.com/SukuWc/fields/pull/18)
- [x] URL-synced settings controls: [#7](https://github.com/SukuWc/fields/pull/7)
- [x] Scenario description panel: [#12](https://github.com/SukuWc/fields/pull/12)
- [x] Overlay lines drawn above the wind-field heatmap: [#13](https://github.com/SukuWc/fields/pull/13)

