# Sim server (phase 5)

An authoritative Node WebSocket server. Each room runs one `SimCore` (`src/host.js`, the same code as the in-browser hosts) at 30 Hz. The browser connects to it with `RemoteHost` (`src/remote-host.js`), which implements the same SimHost interface as `LocalHost` and `WorkerHost`.

## Run locally

```sh
npm ci
npm run server                      # builds dist-server/server.mjs and listens on ws://localhost:8787
npm start                           # vite dev server in another terminal
# open http://localhost:5173/fields/?host=remote&server=ws://localhost:8787
```

Options: `node dist-server/server.mjs --port 8787 --field-hz 2 --field-scale 1 --lockstep --verbose`. `PORT` in the environment also sets the port.

- `--lockstep`: each tick is driven by a client `tick` message instead of the server clock. Runs are reproducible; `test/server.test.mjs` uses it from Node (`RemoteHost.tick`). It is test-only: the browser page is frame-driven in remote mode and never sends `tick`, so a page against a lockstep server stays on the restart frame.
- `--field-hz N`: field texture messages per second (default 2; 0 = no field).
- `--field-scale N`: field texels per root cell at resolution 1 (default 1: 1 m per texel on the default 4f grid).
- `GET http://localhost:8787/`: JSON status (rooms, clients, ticks, last tick ms).

Rooms: `?room=name` on the server URL (`server=ws://localhost:8787/?room=race1`). The first client's map size and simRes create the room. Later clients join the same Sim, and the room is dropped when its last client leaves.

## Choosing the host in the client (`src/host-choice.js`)

| | |
|---|---|
| default build | WorkerHost (LocalHost fallback) |
| `?host=remote&server=ws://…` | RemoteHost |
| `?host=local` / `?worker=0` | LocalHost |
| `VITE_SIM_HOST=remote VITE_SIM_SERVER_URL=wss://… npm run build` | remote by default (`?host=local` still works) |

Params equal to the build default are removed from the URL. If the server can't be reached before its first message, the page falls back to LocalHost and logs a warning.

## Protocol

`src/host-protocol.js` is shared with the worker. It uses JSON text messages: `init`, `command`/`query` → `result`, `event`, `frame`, `input` (held keys + camera, sent only when they change), and `tick` in lockstep. The field is a binary message: u32 width, u32 height (little endian), then RGBA bytes.

## Frame clock and broadcast

- The room ticks on a fixed 30 Hz clock (`Room._start`). Each tick is computed at the start of its 33.3 ms slot and broadcast at the slot's end, so a cheap tick waits for its slot: the server never sends faster than 30 Hz and never runs ahead of real time. A tick slower than 33 ms is broadcast as soon as it finishes, and the next slot starts then: no catch-up burst, the room just runs slower than real time.
- Every frame goes to every client in the room (a due field texture is sent first, then the `frame` JSON with its `tick` number). The server doesn't wait for clients; `ws` buffers per socket.
- The page is event-driven in remote mode (`src/main.js`, `remoteDriven`): no `requestAnimationFrame` loop (renderer `setAnimationLoop` off, perf overlay updated per frame), no local tick loop, no interpolation or prediction. Each arriving frame updates the camera, HUD, readout, guides, cursor wind readout, perf overlay and field texture, then renders once (`renderNow`). Keys and touch send `input` when they change; the camera position (rounded to 0.1 m) is resent when it moves after a frame.
- Slow client: `RemoteHost` counts every frame on arrival (`framesReceived`, `onFrameArrival`) but hands frames to the page from a posted task. If several arrive before the page gets to run, only the newest is rendered and the rest are counted in `framesDropped`. Pass `coalesce: false` to deliver every frame (the lockstep tests do).
- `test/remote-frames.test.mjs` checks this: two clients receive every frame with consecutive matching ticks and identical content, cheap ticks on a 20 × 20 m grid broadcast at ≤ 30 Hz without bursts, 60 ms ticks go out every ~61 ms and return to 30 Hz without a burst, and a client that falls behind renders only the newest frame.

## Decisions

- **Field streaming:** the server paints a reduced RGBA texture, only when one is due (painting is skipped otherwise), and sends it at 2 Hz. On 100 × 200 m with 4f that's 100 × 200 texels = 80 KB per message, about 160 KB/s per client. That's fine on localhost or a LAN, but too much for real remote play. Next steps (phase 6): a quantized speed grid (Uint8, ~16 KB) coloured on the client, or no field by default.
- **Authority:** the server's clock is authoritative. All clients' held keys are merged, and every client controls boats 0/1 (no boat assignment yet). Any client's restart or settings change applies to the whole room. Each page restarts its URL's scenario when it connects.
- **No npm workspaces:** the server sources live in `apps/server` (with a tiny `package.json` that only sets `"type": "module"`). `ws` and `esbuild` are root dependencies, and `npm run build:server` bundles everything, including planck, into one file. Splitting into `packages/sim-core`, `apps/web` and `apps/server` would move every `src/` import, the Vite config and the test paths, for no runtime gain yet. Revisit when the server gets its own deploy (Docker).
- **CPU:** one 4f room with a single boat costs ~30 ms per tick on the dev box, which is right at the 33 ms budget. Heavier scenarios (two-boat rule scenarios) drop below 30 Hz. A slow tick is broadcast when done and the room simply runs slower than real time (no catch-up). This answers plan Q2 for now: a room per core, or a coarser server grid.

## Player boats

In a remote room, the settings panel (the ☰ menu on phones) shows a name field and **Join with my boat**. The server spawns a boat for that connection (`spawnBoat` → `{ id, index, x, y, name }`). It goes below the start line when there is one, otherwise around boat 0, at least 9 m from every boat and mark, and starts on autopilot. That connection owns the boat:
- its keys, touch buttons and boat commands drive only its own boat (`{ boat: 0 }` is remapped to `{ boatId }`);
- the camera follows it;
- it has a name badge and a hull colour picked from the name.

**Leave** (`removeBoat`, own boats only) or closing the page removes the boat. A client that hasn't joined still drives scenario boats 0/1 as before.

Room-wide: a scenario restart or a settings change from any client applies to everyone, and a restart removes every player boat (clients get `ownBoats: []` and can join again). The readout panel shows the scenario's telemetry boat, not necessarily your own.
