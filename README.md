<p align="center"><img src="assets/sailzone-logo.svg" alt="SailZone - Race the rules." width="360"></p>

# fields

## Roadmap

Last updated: 2026-10-06

### 1. Stabilize
- [x] Fix scenario 1 crash (out-of-bounds read in `get_field_velocity`): [#2](https://github.com/SukuWc/fields/pull/2)
- [x] AMR coupling corrections and one-cell domain shifts: [#3](https://github.com/SukuWc/fields/pull/3)
- [x] Circular disk refinement around the boat: [#4](https://github.com/SukuWc/fields/pull/4)
- [x] Constant-wind dev mode with the fluid sim off (`?devmode=1`): [#2](https://github.com/SukuWc/fields/pull/2)

### 2. Wind and boat feel
- [ ] Fluid sim on (in progress, [#9](https://github.com/SukuWc/fields/pull/9))
- [ ] Per-boat wind shadow / dirty air
- [ ] Strategy tuning

### 3. Multiplayer open water
- [ ] Shared world and shared wind
- [ ] Soft physical collisions (bump and slow)
- [ ] Server-authoritative collisions
- [ ] Reconnect

### 4. Core race loop
- [ ] Course: start line, marks, finish, boundary
- [ ] Equal boats
- [ ] Race states
- [ ] Replay scrub

### 5. Rules engine
- [x] Primitives: overlap, clear ahead/astern: [#6](https://github.com/SukuWc/fields/pull/6)
- [ ] Primitives: keep-clear border, zone, mark-room
- [x] Rule registry, all-pairs evaluation, resolver: [#11](https://github.com/SukuWc/fields/pull/11)
- [x] Rule 10: [#5](https://github.com/SukuWc/fields/pull/5)
- [x] Rule 11 and Rule 12: [#6](https://github.com/SukuWc/fields/pull/6)
- [x] Rule 13: [#8](https://github.com/SukuWc/fields/pull/8)
- [ ] Rule 14 with real collisions (partial: [#12](https://github.com/SukuWc/fields/pull/12) detects contact)
- [x] Rule 15: [#10](https://github.com/SukuWc/fields/pull/10)
- [ ] Rule 16.1
- [ ] Start / OCS and individual recall
- [ ] Rule 18
- [ ] Rule 31
- [ ] Rule 28
- [ ] Penalties and exoneration (partial: [#12](https://github.com/SukuWc/fields/pull/12) assigns fault on contact)
- [ ] Incident log (partial: [#12](https://github.com/SukuWc/fields/pull/12) stores contact incidents and a FAULT badge)
- [ ] Rule-stack labels (partial: [#12](https://github.com/SukuWc/fields/pull/12) shows the active rule and inhibited rules)

### 6. Closed beta polish
- [ ] Performance
- [ ] Crash recovery
- [ ] Spectator mode
- [ ] Accessibility
- [ ] Telemetry export

### Other
- [x] SailZone logo: [#14](https://github.com/SukuWc/fields/pull/14)
- [ ] SailZone icon-only logo (in progress, [#15](https://github.com/SukuWc/fields/pull/15))
- [x] URL-synced settings controls: [#7](https://github.com/SukuWc/fields/pull/7)
- [x] Scenario description panel: [#12](https://github.com/SukuWc/fields/pull/12)
- [x] Overlay lines drawn above the wind-field heatmap: [#13](https://github.com/SukuWc/fields/pull/13)
