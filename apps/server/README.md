# Sim server (phase 5)

An authoritative Node WebSocket server. Each room runs one `SimCore` (`src/host.js`, the same code as the in-browser hosts) at 30 Hz. The browser connects to it with `RemoteHost` (`src/remote-host.js`), which implements the same SimHost interface as `LocalHost` and `WorkerHost`.

## Run locally

```sh
npm ci
npm run server                      # builds dist-server/server.mjs and listens on ws://localhost:8787
npm start                           # vite dev server in another terminal
# open http://localhost:5173/fields/?host=remote&server=ws://localhost:8787
```

Options: `node dist-server/server.mjs --port 8787 --field-hz 2 --lockstep --verbose`. `PORT` in the environment also sets the port.

- `--lockstep`: each tick is driven by a client `tick` message instead of the server clock. Runs are reproducible; `test/server.test.mjs` uses it from Node (`RemoteHost.tick`). It is test-only: the browser page is frame-driven in remote mode and never sends `tick`, so a page against a lockstep server stays on the restart frame.
- `--field-hz N`: a field message every 30/N ticks (default 2, i.e. every 15 ticks: 2 per second when the room keeps real time; 0 = no field). `--field-scale` is gone: the server sends the lattice at full resolution (see Field streaming).
- `GET http://localhost:8787/`: JSON status (rooms, clients, ticks, last tick ms).

Rooms: `?room=name` on the server URL (`server=ws://localhost:8787/?room=race1`). The first client's map size, simRes and scenario (its `?scenario_selector`) create the room. Later clients join the same Sim as it is: joining or reloading never restarts the room or sends settings (see Room state). The room is dropped when its last client leaves.

## Choosing the host in the client (`src/host-choice.js`)

| | |
|---|---|
| default build | WorkerHost (LocalHost fallback) |
| `?host=remote&server=ws://…` | RemoteHost |
| `?host=local` / `?worker=0` | LocalHost |
| `VITE_SIM_HOST=remote VITE_SIM_SERVER_URL=wss://… npm run build` | remote by default (`?host=local` still works) |

Params equal to the build default are removed from the URL. If the server can't be reached before its first message, the page falls back to LocalHost and logs a warning.

## Protocol

`src/host-protocol.js` is shared with the worker. It uses JSON text messages: `init` → `welcome`, `command`/`query` → `result` (`{ error }` when the server refuses a command), `event`, `frame`, `statics`, `input` (held keys only, sent when they change), `tick` in lockstep, and the per-client subscriptions `field` (`{ on, plotType, contrastExp }`: whether this client shows the field and which plot), `flow` (`{ on }`: flow tracer grids) and `perf` (`{ on }`: perf counters). Field data is a binary field grid message (layout in `src/fieldPainter.js`, above `encodeFieldGrids`); flow grids and perf counters arrive as `{ type: 'flow', flow }` / `{ type: 'perf', perf }` just before the frame they belong to, to subscribers only.

## Field streaming

- **Grids, not an image.** Each field message holds the root grid and every refinement domain (`bm.domains`, recursively `domain.domains`) as its own grid: origin and cell size `dx` in root cells, width, height. The order is depth first, so painting in order layers them like local `FieldPainter.paint`. A domain sends its interior nodes. Nodes outside its disk are marked hidden, so the parent shows there (the staircase), as in local mode.
- **One byte per cell.** The value is the selected plot's palette index (the one local mode would use, clamped to the palette) quantized to 0–253. 254 = barrier, 255 = hidden. The header carries plotType and `scale`/`offset`/`base`, so `value = base + (byte/253 − offset)/scale` gives rho, ux, uy, speed or curl back (`decodeFieldValue`).
- **Painted on the client.** `RemoteHost` decodes it and `FieldPainter.paintGrids` paints it into the page's texture with the local palette, texture size and layering. Against a local paint of the same lattice the difference is at most one palette step (max channel difference 3 of 255 on scenario 0; `test/field-grids.test.mjs`).
- **Only to clients that show it.** The page sends `field` when its **Show field (server)** box (server mode only, `?field_plane=0`) or dev mode changes, and the plot with the `plot` command. Plot options are per client. When a field message is due, the room encodes the lattice once per distinct plot among the clients showing the field and sends it to those clients only. If nobody shows it, or dev mode is on, nothing is encoded. New clients start with the field off until they ask.
- **Size** (scenario 0, 100 × 200 m, 4f): 6 grids, 22 211 B per message with one boat (the old flattened RGBA image: 80 008 B at 1 m/texel, missing the fine levels). With three boats: 63 979 B. Encoding takes ~0.5–2.5 ms. Compression and delta frames are a later step. The per-frame JSON used to be ~40 KB (bodies, guides and HUD); see Frames below.

## Frame clock and broadcast

- The room ticks on a fixed 30 Hz clock (`Room._start`). Each tick is computed at the start of its 33.3 ms slot and broadcast at the slot's end, so a cheap tick waits for its slot: the server never sends faster than 30 Hz and never runs ahead of real time. A tick slower than 33 ms is broadcast as soon as it finishes, and the next slot starts then: no catch-up burst, the room just runs slower than real time.
- Every frame goes to every client in the room (a due field message is sent first, to the clients showing the field, then the `frame` JSON with its `tick` number). The server doesn't wait for clients; `ws` buffers per socket.
- The page is event-driven in remote mode (`src/main.js`, `remoteDriven`): no `requestAnimationFrame` loop (renderer `setAnimationLoop` off, perf overlay updated per frame), no local tick loop, no interpolation or prediction. Each arriving frame updates the camera, HUD, readout, guides, cursor wind readout, perf overlay and field texture, then renders once (`renderNow`). Keys and touch send `input` when they change. The camera is not sent (nothing on the server uses it).
- Slow client: `RemoteHost` counts every frame on arrival (`framesReceived`, `onFrameArrival`) but hands frames to the page from a posted task. If several arrive before the page gets to run, only the newest is rendered and the rest are counted in `framesDropped`. Pass `coalesce: false` to deliver every frame (the lockstep tests do).
- `test/remote-frames.test.mjs` checks this: two clients receive every frame with consecutive matching ticks and identical content, cheap ticks on a 20 × 20 m grid broadcast at ≤ 30 Hz without bursts, 60 ms ticks go out every ~61 ms and return to 30 Hz without a burst, and a client that falls behind renders only the newest frame.

## Decisions

- **Field streaming:** see above (per-level 1-byte grids, coloured on the client, only to clients showing the field). It replaced a flattened RGBA texture (80 KB per message at 1 m/texel).
- **Authority:** the server's clock is authoritative. Each client steers only its own boat; scenario boats are the scenario's. Room-wide settings can be changed by any client (no owner or admin role yet), are validated by the server and broadcast to every client. A page loads its URL's scenario only when it creates the room.
- **No npm workspaces:** the server sources live in `apps/server` (with a tiny `package.json` that only sets `"type": "module"`). `ws` and `esbuild` are root dependencies, and `npm run build:server` bundles everything, including planck, into one file. Splitting into `packages/sim-core`, `apps/web` and `apps/server` would move every `src/` import, the Vite config and the test paths, for no runtime gain yet. Revisit when the server gets its own deploy (Docker).
- **CPU:** one 4f room with a single boat costs ~30 ms per tick on the dev box, which is right at the 33 ms budget. Heavier scenarios (two-boat rule scenarios) drop below 30 Hz. A slow tick is broadcast when done and the room simply runs slower than real time (no catch-up). This answers plan Q2 for now: a room per core, or a coarser server grid.

## Player boats

In a remote room, the settings panel (the ☰ menu on phones) shows a name field and **Join with my boat**. The server spawns a boat for that connection (`spawnBoat` → `{ id, index, x, y, name }`). It goes below the start line when there is one, otherwise around boat 0, at least 9 m from every boat and mark, and starts on autopilot. That connection owns the boat:
- its keys, touch buttons and boat commands drive only its own boat (`{ boat: 0 }` is remapped to `{ boatId }`);
- the camera follows it;
- it has a name badge and a hull colour picked from the name.

**Leave** (`removeBoat`, own boats only) or closing the page removes the boat. One boat per client (`MAX_BOATS_PER_CLIENT`), at most 8 player boats per room (`MAX_PLAYER_BOATS`); a refused spawn answers `{ error }`.

A client without a boat is **spectating**: the server drops its boat commands and held keys (never applied to scenario boats or other players' boats), it has no key binding (the server sends each client `bindControls` with its own boat count, not the scenario's), and the player panel and the touch panel say "Spectating: join with your boat to sail". After **Leave** it is a spectator again. Each boat has one owner, so keys from several clients never combine on one boat. (A `--lockstep` room, tests only, still lets a client without a boat drive scenario boats 0/1, so lockstep runs match LocalHost.)

A room-wide restart (or a simRes / refinement layout change, which restarts) keeps player boats: after the new scenario's first tick, each is spawned again with the same name and colour and owned by the same client (new id; `ownBoats` and `bindControls` are sent again).

The readout, start panel and course progress show your own boat (`state.hud.own`, per player boat: telemetry, start status, course progress; `hudFromState(hud, ownId)`). A spectator, like the local and worker pages, sees the scenario's (the last boat's telemetry, boat 0's start and course).

## Room state and settings panels

The settings panel has two parts. **Player** (`#player_panel`): this page only (join / leave, flow tracers and their inputs, show field, forces, camera follow and moves, zoom, perf overlay, touch controls, plot and contrast). **Room settings** (`#admin_panel`): scenario select and restart, wind angle and speed, dev mode, mesh refinement, barrier, boat energy, simulation resolution, refinement layout, refinement budget, and (local and worker only) map size.

In a server room:
- The reply to `init` is one **welcome** snapshot: `{ info, room: { scenario: { index, title, description }, settings, lattice }, own, bindings }` (`SimCore.roomState()`). The page starts from it: the room panel shows the room's values, the field plane and texture take the room's lattice and map size (`host.info`), and nothing is sent back. URL values for room settings are not applied (`installUrlSettings(…, { exclude: '#admin_panel' })`); the map size select is hidden.
- Any client may change room settings (no owner yet). The server validates each command (`validateRoomCommand`: scenario index that exists and fits the room's map, wind angle finite and speed 0–30 m/s, booleans for dev mode / barrier / options, a known simRes, `auto` or `fixed` layout, budget target 1000–1e8 or null) and refuses bad ones with `{ error }` (shown in the room panel). After each change every client gets `{ type: 'event', ev: { type: 'room', room } }` and applies it: scenario card and select, wind, checkboxes, selects, dev-mode banner, and the field plane size when the lattice was rebuilt.
- Player settings stay per client: field plot (`field`, `plot`), flow tracers (`flow`: the server samples the wind grid only while some client shows them, and sends it only to those), perf counters (`perf`), camera, forces, touch.

Local and worker pages show both panels and work as before (the page loads its scenario and pushes its settings, URL values included).

## Frames: compact state

A `frame` carries a compact scene `state` (`src/scene-state.js`): per boat position, body angle, hull angle, AWA, true wind direction, autopilot, rudder, drawn boom angles, sail flap, forces; mark positions; start / course / finish / boundary state (sequence clock and flags, next mark, rounded marks, finish labels); rule overlays (mark and boundary room badges, contacts, mark touches, penalties, and the two-boat encounter overlays as `rules.js` `pairGuideState`: kind, the two boat positions, rule codes, Rule 15 progress, stern-mark points, label stack); the readout / HUD values (`state.hud`, `src/hud.js`: telemetry, start sequence clock and signal id, course progress, leaderboard rows, per-boat rules status); the refinement domains (rectangle, disk, mask as base-36 run lengths); and the transforms of moving bodies. Every client builds its guides, body outlines and the readout / start HUD / leaderboard panels from it with `src/scene-build.js` `buildScene(state, statics, view, ownId)`, the same code the local and worker pages use.

Statics (boat hull/rudder/sail numbers and names, body shapes, mark anchors, course, start and finish layout, boundary, lattice size) are not in frames. The room sends `{ type: 'statics', sv, statics }` to a client before the first frame it needs them for: on join, and to everyone again when they change (restart, a spawned or removed boat). `state.sv` names the version a frame was built against. Numbers in server JSON are rounded to 1e-4 (multiples of 1/4096 such as cell sizes are kept exact); the built scene stays within 1e-3 m of the local one (`test/scene-state.test.mjs`).

Nothing is sent as ready-made geometry or HTML. Strings left in the state are data: incident labels and reasons ("Rule 31 · touched mark 2"), room bases ("east boundary"), rule names that have no short code. The HUD values, penalty badges and finish labels are exempt from the 1e-4 rounding (`host-protocol.js` `markExact`), so their text reads the same in every mode.

Measured (scenario 0, 100 × 200 m, 4f, field off, text bytes one RemoteHost receives from an in-process server, 8 s windows):

| | before | after |
|---|---|---|
| 1 boat, bytes per frame | 40 889 | 1 771 |
| 1 boat, B/s (24–26 frames/s) | 984 523 | 45 964 |
| 3 boats, bytes per frame | 104 306 | 5 010 |
| 3 boats, B/s (7.5–8.4 frames/s) | 780 139 | 41 928 |

Statics: 700 B (1 boat), 1 202 B (3 boats), once per change. The biggest scenario frames are now ~8 KB (scenario 18, four boats; was ~138 KB).

Client-built HUD and pair overlays (frame bytes per tick, lockstep room, ticks 30–180, scenario 18 ticks 30–450, 4f; before = the HUD as HTML strings and pair overlays as guide records):

| | before | after | HUD part | pair part (frames with encounters) |
|---|---|---|---|---|
| scenario 0, 1 boat | 1 864 | 1 778 | 277 → 191 | – |
| scenario 0, 3 boats | 5 850 | 5 165 | 329 → 244 | 855 → 256 |
| scenario 18, four boats | 8 309 | 6 813 | 345 → 251 | 2 012 → 610 |

Telemetry values the readout floors travel floored (whole units or tenths, as integers); everything else in `state.hud` is exact.
