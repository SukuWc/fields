# Contributing to Fields

Rules agreed in the team all-hands on the sim/client split. The sim owns all state; the client only draws and sends commands.

## Architecture

1. **No DOM, canvas or `window` in sim modules.** Anything visible is client code that reads frame state.
2. **New state the client needs goes in the compact frame or snapshot**, kept small and covered by a test.
   - Fixed data (hull shapes, course layout, names) goes in the snapshot; changing data goes in the frame.
   - The rules engine (right of way, mark-room, boundary room, penalties, finish results) stays in the sim. The client only draws the labels and badges it gets in the frame.
3. **Every feature works in local, worker (default) and `?host=remote` mode.** Check worker and remote before asking for review.
   - **Every new setting is either room or player.** Room settings are a validated room command set through the Room settings panel and broadcast to everyone. Player settings stay on the page or become a per-client subscription (like the field, flow and perf streams). Never send a player setting as a room command, and never send commands on join.
   - **Find boats by id, never by index in `sim.players`.** Player boats and scenario boats share that array.
   - **Sim time is ticks**, never wall clock or frame rate. The server may run below 30 Hz, and the client reacts only to frames.
   - **Wind is real m/s everywhere** (#67).

## Process

4. **Merge only when CI has finished green**, not while it is pending. Behaviour changes come with updated check scripts or tests.
5. **One topic per PR, kept small.**
   - Update a branch by merging `main` into it. No rebase, no force-push, also when a squash merge leaves the branch conflicting.
   - Say in the description if the PR is stacked on another.
   - Changes to `.github/workflows/` go through SukuWc (agents can't push there).
6. **Scenarios are shared fixtures.** Don't renumber or retune a scenario without updating its check script. New scenarios are only appended at the end.
7. **Fluid sim PRs** report before/after ms per tick from the Perf panel, including per-level and tracking time (#72), and state the sim mode measured. Also run `PROP_FULL=1 node scripts/propagation.mjs` and scenario 0 and paste the results in the description.

### Scenarios and their checks

Sources: `CLAUDE.md`, the `scenario_selector` title in `index.html`, and `scripts/*-check.mjs`. "—" means no check script drives that scenario directly.

| # | Scenario | Check script |
|---|---|---|
| 0 | Single boat autopilot | `sim-res-check.mjs`, `budget-check.mjs` |
| 1 | Two-boat race | `budget-check.mjs` |
| 2 | Multi-boat automated sequence (port/starboard crossing) | `rule10-check.mjs` |
| 3–4 | Multi-boat automated sequences | — |
| 5 | Empty template | — |
| 6 | Rule 13 tack | — |
| 7 | Leeward boat tacks into a Rule 10 collision | — |
| 8 | Rule 15 overlap | — |
| 9 | Contact during Rule 15 | — |
| 10 | Penalty turn: tack + gybe, Q/E autopilot circle | `penalty-turn-check.mjs` |
| 11 | Anchored mark buoy, boat hits it | `mark-check.mjs`, `mark-touch-check.mjs` |
| 12 | Anticlockwise triangle course, marks to port | `course-check.mjs` |
| 13 | Windward mark and leeward gate | `gate-check.mjs` |
| 14 | Start sequence, OCS individual recall, windward mark and gate | `start-check.mjs` |
| 15 | Rule 18.2 mark-room at the leeward gate | `rule18-check.mjs` |
| 16 | Finish line and results, unserved penalty → time penalty | `finish-check.mjs` |
| 17 | Three-boat test race with live leaderboard | `leaderboard-check.mjs` |
| 18 | Fleet of four upwind (refinement budget) | — |
| 19 | Virtual boundary, room to tack away | `boundary-check.mjs` |

## Branding

- `brand-kit/` and the logo/icon in `assets/` are the source of truth. Use them from there; don't copy or regenerate them. Change them only in their own small PR.
- UI colors come from `brand-kit/colors.md`. Green and red mean starboard and port only.
- Branding, the favicon and the social preview image stay client-only.
