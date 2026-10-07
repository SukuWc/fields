# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm start          # Start dev server (Vite, hot reload, typically http://localhost:5173)
npm test           # Headless AMR coupling checks (node test/amr.test.mjs)
npm run build      # Production build, Vite base /fields/ (output: dist/). PR previews set VITE_BASE_PATH.
```

## Dependency notes

`planck-js` is intentionally pinned at `^0.3.31`. The newer `planck` package (v1+) has breaking API changes and requires a `stage-js` peer dependency that is incompatible with `planck-renderer@2.2.0` (already at latest). Do not upgrade `planck-js` or `planck-renderer` without significant migration work.

## Architecture

This is an interactive web sailing simulator combining 2D fluid dynamics with 3D rendering.

### System Overview

```
src/main.js           — Entry point: constants, texture setup, physics loop (Runner)
src/renderer.js       — Three.js scene init and animation loop
src/controls.js       — Keyboard/mouse input, DOM UI listeners, scenario management
src/url-settings.js   — Sync #settings controls with the query string (non-defaults only)
src/utils.js          — range_map and HSVtoRGB helpers
src/wind.js           — Wind providers (fluid-sampled and constant). Boats only see Map.get_wind
src/boltzmann.js      — Lattice Boltzmann Method (LBM) fluid simulator
src/boat.js           — Sailboat physics, aerodynamics, autopilot
src/map.js            — Planck.js world container, camera control, wind queries
```

### Simulation Loop

The physics runner (`planck-renderer` `Runner`) in `main.js` runs at 30 FPS:
1. `executeScenarioFrame()` — fire timed scenario callbacks
2. `processKeys()` — dispatch held-key bindings
3. `boat.physics_model_step()` — aerodynamic force calculation + Planck.js integration
4. Boat→fluid energy application (`bm.apply_energy`)
5. `bm.physics_model_step()` — Boltzmann fluid advance
6. `map.physics_model_step()` — camera follow update
7. Three.js render (`DataTexture` for fluid field, line geometry for physics bodies)

In dev mode the loop still runs scenarios, keys, boats, and the camera, but it does not apply boat→fluid energy, does not move AMR domains, and does not call `bm.physics_model_step()`. See Dev mode below.

### Module responsibilities

- **`main.js`** owns: `dataTextureMaterial`, `bm`, `map`, `runner`, `guides[]`, and the physics loop. Passes a `() => guides` getter to `renderer.js` so the render loop can read guides without coupling.
- **`renderer.js`** owns: `camera`, `scene`, `renderer`, `polygons[]`, `arrows[]`. `initRenderer` must be called before `setupControls` (controls needs `getCamera`).
- **`controls.js`** owns: `key_bind_list`, `key_state`, `players[]`, `scenario_descriptor`, `physics_frame`, scenario definitions. `_map` is set lazily in `setupControls`; scenario closures safely reference it since they execute after setup.

### Boltzmann Fluid Engine (`boltzmann.js`)

Uses the **D2Q9 lattice** (9-velocity 2D LBM). Key classes:

- `SimulationCell` — single lattice node. Fields match paper notation: `f0, fN, fS, fE, fW, fNE, fNW, fSE, fSW` (post-collision populations), `fN_in … fSW_in` (incoming buffers), `rho`, `ux`, `uy`, `curl`. `recomputeMacros()` refreshes ρ and u from the populations after streaming or a grid transfer.
- `Boltzmann` — top-level class. Owns `cells[]` (all cells), `interiorCells[]` (interior nodes not covered by a child), `_allInteriorCells[]` (every interior node, including covered ones), and the `collideAndStream(cells, omega)` helper that runs one full LBM step (collide→stream→bounce→consolidate) on any cell array. Step order in `physics_model_step`: collide → stream → bounce → consolidate → `setBoundaries` (boundaries enforced after propagation, per paper). The coarse step runs on `_allInteriorCells` so a pull from a covered neighbour sees post-collision populations; `averageToCoarse` then overwrites the covered nodes.
- **Adaptive mesh refinement** is multi-domain (`RefinementDomain`). The rectangle is a reusable window; a per-cell mask (`setDisk`) refines a circle rasterized on the parent lattice. Diagonal-only 2×2 contacts are closed so every interface edge has a neighbour for the existing 1D cubic. Edge ghosts (one axis half-integer, or a coincident node just outside) and corner ghosts (both axes half-integer) are the overlap: coupling from the rectangular scheme runs on that staircase. Each level runs two sub-steps per parent step (convective scaling, ratio 2). `omega_f` follows Eq. 24. Coarse→fine coupling rescales non-equilibrium populations (Eq. 29) with cubic spatial interpolation (Eqs. 38/39) or a direct copy on coincident nodes (Eq. 34). Fine→coarse restriction takes ρ and u from the coincident fine node and filters only `f_neq` on the centered D2Q9 stencil (Eq. 33), then rescales (Eq. 30). Ghost boundaries interpolate ρ, u, and `f_neq` between the two parent time levels (§3.5). A window moves with `shiftDomain` / `shiftBy`: one parent cell at a time, in place, restricting cells that leave and carrying nested domains with it. `main.js` recenters a window when the boat is more than one cell from its center. Level 2 is a smaller disk inside level 1. Overlapping boats: the refined region is the union of the masks; the finest level writes the parent node and is what sampling and sail forcing read; the same level, the later domain wins.
- **AMR reference paper**: Lagrava, Malaspinas, Latt, Chopard — *"Advances in multi-domain lattice Boltzmann grid refinement"*, J. Comput. Phys. 231:4808–4822, 2012. DOI: 10.1016/j.jcp.2012.03.015. PDF at `research/lagrava_gr_2012.pdf`. This is the paper the multi-domain coupling follows (cell-vertex, convective scaling, Dupuis–Chopard non-equilibrium rescaling).
- **Debug visualisation**: `RefinementDomain.worldBorderLines(bm)` returns a smooth circle for that boat's disk (four rectangle segments when no disk is set). The light staircase (`0x9ad0ff`) is the outer boundary of the union of every mask at that refinement level (`unionMaskBorderLines`): overlapping boats share one outline, and boats that do not touch keep a separate island. Level 1 and level 2 are drawn separately. Nested circles convert each parent axis with that axis's root origin (`cx0_root` / `cy0_root`); using the horizontal origin for both axes draws the inner disk away from the boat. `main.js` pushes guides after the windows move, so the circles match the boat on that frame. `trackBoats` pairs each boat with its own window, so a skipped boat does not leave an index hole the next boat's domain falls into.

### Boat Physics (`boat.js`)

Each `Boat` instance:
- Has hull, rudder, mainsail, and jib represented as Planck.js bodies/fixtures
- Computes aerodynamic forces via pre-computed lift/drag curves (look-up tables in `docs/`)
- Has an **autopilot** with heading PID-style control (`autopilot_heading`, `autopilot_active`)
- Queries `map.get_wind(x, y)` each step. That is the only wind seam: it returns `{ speed, direction, vx, vy }` from whichever provider is active (`FluidWind` or `ConstantWind`)

### Wind seam (`wind.js`, `map.js`)

Boats never sample the lattice. `Map.get_wind(x, y)` delegates to the active provider:

- `FluidWind` — averages `bm.get_field_velocity` over a ±2 world-unit stencil (the historical `Map.get_wind` body). `vx`/`vy` are lattice velocity / 4. `speed` is `|v| * 400`, which recovers the UI wind speed (`Boltzmann` stores inlet speed as `uiSpeed / 100`, and `get_field_velocity` divides by 4). `direction` is `atan2(vy, vx)` in degrees + 180.
- `ConstantWind` — the same vector at every position. Constructed from the `wind_angle` and `wind_speed` constants at the top of `main.js`. For a given angle and speed it matches `FluidWind` on a uniform field, so boats feel the same force in both modes.

`direction` is where the wind **comes from** (0 = from +X, 90 = from +Y). `(vx, vy)` points **downwind**, which is the lattice flow and the direction sail drag pushes the boat. Wind indicators (the dev-mode arrow and the per-boat true-wind ticks) point downwind. The dev-mode banner prints both: `from 90° to 270°`.

`Map.setDevMode(on)` selects `ConstantWind` or `FluidWind`. `Map.setWindProvider(provider)` installs any object with `getWind(x, y)` and is reset the next time `setDevMode` runs.

### Dev mode (constant wind)

Dev mode is for working on a racing-rules engine without the fluid sim's cost or variability. Boats, autopilot, scenarios, camera, and physics-body rendering keep running. The fluid texture plane is hidden. A cyan arrow follows the camera and points downwind; the banner states where the wind comes from and where it blows.

Turn it on either way:

- **Dev mode** checkbox at the top of the `#settings` panel. Fluid-only controls (mesh refinement, barrier, boat energy, plot sliders) are disabled while it is on; their checked state is kept and applies again when dev mode is turned off.
- URL query `?devmode=1` (also `true`). Every settings control in `#settings` (checkboxes, number and range inputs, and the plot dropdown) is mirrored into the query string by `installUrlSettings`: only non-default values are written, via `history.replaceState`. The dev-mode checkbox uses the existing `devmode` name — `devmode=1` when on, omitted when off. On load the query is applied by setting each control and dispatching `input`/`change`, so the same handlers run as a user edit. **Reset settings** restores the captured defaults and drops those params. Unrelated query keys are preserved.

Defaults are `wind_angle = 90` (from +Y, blowing toward −Y) and `wind_speed = 15` in `src/main.js`, the same inlet wind the lattice is initialized with. The **Wind angle** and **Wind speed** inputs edit the live `ConstantWind`. Wind angle still writes `bm.direction` (UI angle + 180), as before. Wind speed writes `bm.speed` as `value / 100`, so the fluid inlet matches if you leave dev mode. The lattice is still constructed and initialized at startup so leaving dev mode resumes the field that was already there; it is just not stepped while dev mode is on.

`get_field_velocity` clamps its bilinear sample to the lattice. The ±2 world-unit stencil used to read `undefined.ux` once a probe crossed the north edge or either negative edge (positive x past the last column wraps into the next row and returns a wrong cell instead of throwing). In-range samples are unchanged.

### Coordinate System

- World space: centered at (0,0), ±`map_w/2` × ±`map_h/2` (default 50×50 units)
- `bm_resolution` (default 2) scales the LBM grid: `map_w * bm_resolution` cells per axis
- Texture oversampling (default 4) further upscales for smoother rendering

### Scenarios

Scenarios are defined in `src/controls.js` as sparse arrays indexed by physics frame number. Scenario 0 = single boat autopilot; 1 = two-boat race; 2–4 = multi-boat automated sequences; 5 = empty template. `map.js` intentionally creates two dynamic circle bodies in `physics_model_init` as world objects.

### Coding conventions for `boltzmann.js`

The LBM implementation is kept as close as possible to the Lagrava paper. Follow these rules when editing:

- **Variable names match paper notation**: `f0, fN, fS, fE, fW, fNE, fNW, fSE, fSW` (Eq. 2), `rho` (ρ), `ux/uy` (u), `nu` (ν), `omega` / `omega_c` / `omega_f` (ω).
- **Equation comments**: every calculation that has a numbered formula in the paper must have a `// Eq. N:` comment on or above it. Current coverage: Eq. 2 (weights), Eq. 3 (equilibrium), Eq. 4/5 (macro fields), Eq. 10 (ω from ν), Eq. 15 (BGK collision), Eq. 16 (streaming), Eq. 24 (fine-grid ω), Eq. 29/30 (non-equilibrium rescaling), Eq. 33 (centered `f_neq` filter), Eq. 34/38/39 (spatial interpolation), §3.5 (sub-cycling and time interpolation).
- **Geographic neighbour naming**: `nbN` = y+1 (north), `nbS` = y−1, `nbE` = x+1, `nbW` = x−1, and diagonals accordingly. Pull-scheme streaming reads from the *upstream* geographic direction (e.g. `fN_in = nbS.fN`).
- **No dead code**: remove stale methods rather than commenting them out.
- **`return` and its expression stay on one line.** A newline after `return` is parsed as `return;`. The left-biased Eq. 39 branch in `_injectGhostCell` (`interpX`, `interpY`, `interpXY`) used to do that, which stored `undefined` velocities on the high-index edge of a refinement domain and, once that domain was stepped, NaN'd the lattice.
- **Eq. 5 divides by rho.** If density collapses (rho ≤ 0) the velocity is NaN and streaming spreads it. `collide` resets that cell to rest equilibrium. Restriction (`_restrictCell`) skips the coarse write when the coincident node is missing or its density or velocity is not finite. Boat forcing is the exact-difference kick (`addMomentum`): it refuses a missing cell, a non-finite force, a collapsed density, or a non-finite result. The previous `setEquil` push (`pushCellVelocity`) capped speed at 0.35 because a pinned sail stacked equilibrium on a cell that did not stream. That cap is not on the exact-difference kick: the kick is streamed, and a fine cell's `1/dx²` sample is larger than 0.35 on purpose.
- **Domain boxes are non-empty integer rectangles.** `addDomain` / `moveDomain` drop inverted or non-finite corners (a boat past the wall, or a NaN body). Level-2 boxes are clamped inside the parent in `main.js`.
- **Sail lookup stops at the last table entry.** `aeroCoefficients` clamps the index so awa = ±180 does not read past the 21-entry lift/drag tables (`undefined * 0` is NaN).

### Visualization Modes

The `plotSelect` dropdown controls what the `DataTexture` displays: density, x-velocity, y-velocity, speed, or curl. Contrast and mirror adjustments are applied at render time in `boltzmann.js`.
