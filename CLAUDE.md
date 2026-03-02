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
src/index.js          — Main orchestrator: Three.js scene, simulation loop, UI events
src/boltzmann.js      — Lattice Boltzmann Method (LBM) fluid simulator
src/boat.js           — Sailboat physics, aerodynamics, autopilot
src/map.js            — Planck.js world container, camera control, wind queries
```

### Simulation Loop

The physics runner (`planck-renderer` `Runner`) runs at 30 FPS:
1. Dequeue scenario actions
2. Process keyboard input
3. `boat.physics_model_step()` — aerodynamic force calculation + Planck.js integration
4. `bm.step()` — Boltzmann fluid advance
5. Apply boat↔fluid interaction forces
6. `map.physics_model_step()` — camera follow update
7. Three.js render (`DataTexture` for fluid field, line geometry for physics bodies)

### Boltzmann Fluid Engine (`boltzmann.js`)

Uses the **D2Q9 lattice** (9-velocity 2D LBM). Key classes:

- `SimulationCell` — single lattice node storing 9 microscopic densities (`_n0_`, `_nN_`, `_nS_`, `_nE_`, `_nW_`, `_nNE_`, `_nNW_`, `_nSE_`, `_nSW_`). `sub_mesh_depth` field: `0` = root, `1` = standard cell, `2` = submesh container cell.
- `Boltzmann` — top-level class managing the cell grid, stepping (stream + collide), density/velocity/curl queries, and writing to the Three.js `DataTexture` for visualization.
- Hierarchical **submesh refinement** at grain boundaries: `is_temporary` cells are created at edges to bridge resolution levels. Submesh generation and curl calculation are the most recently developed features.

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

Scenarios are defined in `src/index.js` as `scenario_descriptor` objects with timed action queues. Scenario 0 = single boat autopilot; 1 = two-boat race; 2–4 = multi-boat automated sequences; 5 = empty template.

### Visualization Modes

The `plotSelect` dropdown controls what the `DataTexture` displays: density, x-velocity, y-velocity, speed, or curl. Contrast and mirror adjustments are applied at render time in `boltzmann.js`.
