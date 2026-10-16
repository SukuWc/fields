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

- `--lockstep`: the client's loop drives each tick, as with the worker. Runs are reproducible; the browser comparison and `test/server.test.mjs` use it.
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

## Decisions

- **Field streaming:** the server paints a reduced RGBA texture, only when one is due (painting is skipped otherwise), and sends it at 2 Hz. On 100 × 200 m with 4f that's 100 × 200 texels = 80 KB per message, about 160 KB/s per client. That's fine on localhost or a LAN, but too much for real remote play. Next steps (phase 6): a quantized speed grid (Uint8, ~16 KB) coloured on the client, or no field by default.
- **Authority:** the server's clock is authoritative. All clients' held keys are merged, and every client controls boats 0/1 (no boat assignment yet). Any client's restart or settings change applies to the whole room. Each page restarts its URL's scenario when it connects.
- **No npm workspaces:** the server sources live in `apps/server` (with a tiny `package.json` that only sets `"type": "module"`). `ws` and `esbuild` are root dependencies, and `npm run build:server` bundles everything, including planck, into one file. Splitting into `packages/sim-core`, `apps/web` and `apps/server` would move every `src/` import, the Vite config and the test paths, for no runtime gain yet. Revisit when the server gets its own deploy (Docker).
- **CPU:** one 4f room with a single boat costs ~30 ms per tick on the dev box, which is right at the 33 ms budget. Heavier scenarios (two-boat rule scenarios) drop below 30 Hz. The fixed step drops time it can't catch up (max 4 ticks per wake). This answers plan Q2 for now: a room per core, or a coarser server grid.

## Player boats

In a remote room, the settings panel (the ☰ menu on phones) shows a name field and **Join with my boat**. The server spawns a boat for that connection (`spawnBoat` → `{ id, index, x, y, name }`). It goes below the start line when there is one, otherwise around boat 0, at least 9 m from every boat and mark, and starts on autopilot. That connection owns the boat:
- its keys, touch buttons and boat commands drive only its own boat (`{ boat: 0 }` is remapped to `{ boatId }`);
- the camera follows it;
- it has a name badge and a hull colour picked from the name.

**Leave** (`removeBoat`, own boats only) or closing the page removes the boat. A client that hasn't joined still drives scenario boats 0/1 as before.

Room-wide: a scenario restart or a settings change from any client applies to everyone, and a restart removes every player boat (clients get `ownBoats: []` and can join again). The readout panel shows the scenario's telemetry boat, not necessarily your own.
