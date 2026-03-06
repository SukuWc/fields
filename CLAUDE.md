# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm start          # Start dev server (Vite, hot reload, typically http://localhost:5173)
npm run build      # Production build with base path /fields (output: dist/)
```

No test suite is currently configured.

## Dependency notes

`planck-js` is intentionally pinned at `^0.3.31`. The newer `planck` package (v1+) has breaking API changes and requires a `stage-js` peer dependency that is incompatible with `planck-renderer@2.2.0` (already at latest). Do not upgrade `planck-js` or `planck-renderer` without significant migration work.

## Architecture

This is an interactive web sailing simulator combining 2D fluid dynamics with 3D rendering.

### System Overview

```
src/main.js           — Entry point: constants, texture setup, physics loop (Runner)
src/renderer.js       — Three.js scene init and animation loop
src/controls.js       — Keyboard/mouse input, DOM UI listeners, scenario management
src/utils.js          — range_map and HSVtoRGB helpers
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

### Module responsibilities

- **`main.js`** owns: `dataTextureMaterial`, `bm`, `map`, `runner`, `guides[]`, and the physics loop. Passes a `() => guides` getter to `renderer.js` so the render loop can read guides without coupling.
- **`renderer.js`** owns: `camera`, `scene`, `renderer`, `polygons[]`, `arrows[]`. `initRenderer` must be called before `setupControls` (controls needs `getCamera`).
- **`controls.js`** owns: `key_bind_list`, `key_state`, `players[]`, `scenario_descriptor`, `physics_frame`, scenario definitions. `_map` is set lazily in `setupControls`; scenario closures safely reference it since they execute after setup.

### Boltzmann Fluid Engine (`boltzmann.js`)

Uses the **D2Q9 lattice** (9-velocity 2D LBM). Key classes:

- `SimulationCell` — single lattice node. Fields match paper notation: `f0, fN, fS, fE, fW, fNE, fNW, fSE, fSW` (post-collision populations), `fN_in … fSW_in` (incoming buffers), `rho`, `ux`, `uy`, `curl`. `sub_mesh_depth`: `0` = root, `1` = standard cell, `2` = first submesh level, `3` = second submesh level.
- `Boltzmann` — top-level class. Owns `cells[]` (all cells), `interiorCells[]` (pre-computed interior subset for efficient stepping), and the `collideAndStream(cells, omega)` helper that runs one full LBM step (collide→stream→bounce→consolidate) on any cell array. Step order in `physics_model_step`: collide → stream → bounce → consolidate → `setBoundaries` (boundaries enforced after propagation, per paper).
- **Adaptive mesh refinement (AMR) is early/experimental** — not fully implemented. Depth-2 and depth-3 child cells exist and are initialised via `convert_to_finer_mesh`, which samples a 3×3 neighbourhood at the parent's grid spacing (`step = Math.pow(0.5, sub_mesh_depth - 1)`) so depth-3 cells draw from depth-2 neighbours rather than the root grid. Sub-cells do not yet participate in the main stream/collide/bounce loop.
- **AMR reference paper**: Lagrava, Malaspinas, Latt, Chopard — *"Advances in multi-domain lattice Boltzmann grid refinement"*, J. Comput. Phys. 231:4808–4822, 2012. DOI: 10.1016/j.jcp.2012.03.015. PDF at `research/lagrava_gr_2012.pdf`. This is the paper we are following for the full AMR implementation (multi-domain, cell-vertex, convective scaling, Dupuis-Chopard non-equilibrium rescaling with cubic spatial interpolation and box-filter fine→coarse).
- **Debug visualisation**: `RefinementDomain.worldBorderLines(bm)` returns 4 world-space line segments for the domain boundary; `main.js` pushes these into `guides` each frame so they render as thin Three.js lines.

### Boat Physics (`boat.js`)

Each `Boat` instance:
- Has hull, rudder, mainsail, and jib represented as Planck.js bodies/fixtures
- Computes aerodynamic forces via pre-computed lift/drag curves (look-up tables in `docs/`)
- Has an **autopilot** with heading PID-style control (`autopilot_heading`, `autopilot_active`)
- Queries `map.get_wind_speed(x, y)` / `map.get_wind_direction(x, y)` each step — these average LBM velocities over a 5-point stencil

### Coordinate System

- World space: centered at (0,0), ±`map_w/2` × ±`map_h/2` (default 50×50 units)
- `bm_resolution` (default 2) scales the LBM grid: `map_w * bm_resolution` cells per axis
- Texture oversampling (default 4) further upscales for smoother rendering

### Scenarios

Scenarios are defined in `src/controls.js` as sparse arrays indexed by physics frame number. Scenario 0 = single boat autopilot; 1 = two-boat race; 2–4 = multi-boat automated sequences; 5 = empty template. `map.js` intentionally creates two dynamic circle bodies in `physics_model_init` as world objects.

### Coding conventions for `boltzmann.js`

The LBM implementation is kept as close as possible to the Lagrava paper. Follow these rules when editing:

- **Variable names match paper notation**: `f0, fN, fS, fE, fW, fNE, fNW, fSE, fSW` (Eq. 2), `rho` (ρ), `ux/uy` (u), `nu` (ν), `omega` / `omega_c` / `omega_f` (ω).
- **Equation comments**: every calculation that has a numbered formula in the paper must have a `// Eq. N:` comment on or above it. Current coverage: Eq. 2 (weights), Eq. 3 (equilibrium), Eq. 4/5 (macro fields), Eq. 10 (ω from ν), Eq. 15 (BGK collision), Eq. 16 (streaming), Eq. 24 (fine-grid ω), §3.5 (sub-cycling).
- **Geographic neighbour naming**: `nbN` = y+1 (north), `nbS` = y−1, `nbE` = x+1, `nbW` = x−1, and diagonals accordingly. Pull-scheme streaming reads from the *upstream* geographic direction (e.g. `fN_in = nbS.fN`).
- **No dead code**: remove stale methods rather than commenting them out.

### Visualization Modes

The `plotSelect` dropdown controls what the `DataTexture` displays: density, x-velocity, y-velocity, speed, or curl. Contrast and mirror adjustments are applied at render time in `boltzmann.js`.
