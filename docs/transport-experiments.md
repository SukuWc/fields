# Transport experiments: why phones still lag, and what fixes it

PR #197. **Status: the ack flow-control window is now the default for
every WebSocket client.** The other variants stay in the codebase as
opt-in experiments, chosen per client with a query parameter, so phones
and desktops can be A/B tested in the same room.

| query (page `/play/?…` or WS URL) | hot path | policy |
| --- | --- | --- |
| _(none)_, or `send=ack` (explicit, same thing) | WebSocket | **ack window (default)** |
| `send=legacy` (alias `send=buf`) | WebSocket | main before #197: skip while `bufferedAmount` > 256 KiB, no acks |
| `send=latest` | WebSocket | skip while `bufferedAmount` > 16 KB (shown not to help) |
| `transport=rtc` / `transport=rtc&send=ack` | WebRTC DataChannel | latest / ack window (seq acks) |
| `transport=wt` / `transport=wt&send=ack` | WebTransport streams | ≤ 1 unfinished stream per kind / ack window |
| `ackms=N` (30–1000, default 120) | any | ack window target |

Compatibility:

- **Old cached page against the new server:** it never sends `ack`. The
  server keeps it on the legacy rule until its first ack (`ackSeen: false`,
  `mode: legacy` in `/api/transport`), so it is never starved.
- **New page against an old server:** the old server ignores the unknown
  `ack` message, so nothing changes.
- **Acks that stop mid-session** (stuck tab): after 3 s with bytes in
  flight, the server forgives them (acked = sent). That allows at most one
  window per 3 s, never a permanent stall.
- **Lockstep rooms** (tests) never skip.
- **Native packages** (`node-datachannel`, `@fails-components/webtransport`)
  are optional and loaded lazily. Without them, which is the production
  Docker image:
  - The server starts normally.
  - A `transport=rtc` client gets `{ type: 'rtc', error }` and stays on
    the WebSocket.
  - `--wt-port` logs `webtransport disabled: …`.

Also in this PR:

- The remote room default `field_skip` is now **1**: fields at 15 Hz,
  about half the field bytes. This is set in `ROOM_CONFIG_DEFAULTS`, which
  the fixed rooms use at startup and Reset uses.
- With the ack window, a due field that didn't fit is retried on the next
  ticks, until a newer one is due or it is ~0.5 s old.
- When `ADMIN_SECRET` is unset, room editing is open to everyone. See
  `docs/deploy-coolify.md`.

## TL;DR

- **The remaining phone lag is on the network, not in the phone's JavaScript.**
  The server sends each client about **21 KB per tick**: a 7–8 KB frame plus a
  14–16 KB field keyframe. At 25–30 Hz that is **~4.5–5 Mbit/s per client**.
  A phone on busy WiFi often gets less than that. The surplus queues up in
  front of the bottleneck: in the server's kernel TCP send buffer (up to 4 MB
  on Linux), in the WiFi AP queue and in the receive path. #139's client-side
  "keep only the newest frame" can't drop those frames, because they haven't
  reached JavaScript yet.
- Measured on a simulated 3 Mbit/s phone link (WiFi stalls, CPU-slow phone),
  main falls behind without limit: staleness **p50 15.5 s, max 21.8 s** after 60 s.
  The existing 256 KiB `bufferedAmount` skip (#95) almost never fires.
  `ws.bufferedAmount` was ≤ 277 KB while **7.9 MB** sat unsent or undelivered
  below it.
- A lower `bufferedAmount` threshold (`send=latest`) changes nothing: p50 15.8 s.
  The queue is in the kernel, not in `ws`.
- **The fix that works is end-to-end flow control over the existing WebSocket
  (`?send=ack`).** The client acks the bytes it has received, and the server
  keeps at most ~120 ms worth of data in flight to that client. It skips ticks
  that don't fit, so the next one it sends is always the newest. Result:
  **p50 82 ms, p95 153 ms** on the same link, with no new ports and no new
  dependencies. It works in every browser and behind Coolify's proxy as-is.
- WebRTC DataChannel and WebTransport work too (prototyped, benchmarked), but
  they are **only as good as the same ack window**. Without it, SCTP and QUIC
  congestion control fill the AP queue just like TCP does (WebRTC p50 0.8 s).
  With it, they match `send=ack` and are no better. They also need UDP
  through Docker and Coolify, extra native npm packages and, for WebTransport,
  HTTPS. Not worth it for this problem today.

## How the hot path worked before this PR (now `send=legacy`)

- The server (`apps/server/room.js`, 30 Hz clock) sends, per client and tick,
  a binary frame (wire v1) and, while the client shows the field (the
  default: `field_plane` on, `field_skip` 0), a binary field keyframe. Both go
  over one WebSocket (TCP). `ws` sets `TCP_NODELAY`, and `permessage-deflate`
  is off (ws server default).
- `_publish` skips a client while `ws.bufferedAmount > 256 KiB` (#95).
- The client (`src/remote-host.js`, #139) parks raw binary messages and
  decodes only the newest frame and field once per animation frame.

What's in a frame (5 boats, europe-1 default): `state.boats` 2.8 KB,
`state.amr` 2.1 KB, `state.hud` 1.4 KB, the rest < 0.5 KB.
(`node --import ./test/register.mjs scripts/transport/frame-anatomy.mjs`)

## Root cause, with numbers

Classic browser WebSockets have no receive backpressure: Chrome's network
service keeps reading and buffers the messages for the page. #139 already
handles the case where the page's JavaScript is slow, and it works. The
case it can't handle is a link slower than the send rate.

- With 21 KB per tick × 25–30 Hz ≈ 525–630 KB/s ≈ 4.2–5 Mbit/s per client,
  a phone that gets < 5 Mbit/s of goodput falls behind from the first second.
  With 5 phones on one AP that is likely. Phones also have worse antennas,
  power saving and lower MCS rates than laptops. Desktops don't suffer because
  they get more than 5 Mbit/s.
- TCP never drops data. The backlog moves to wherever the bottleneck is:
  1. The AP or driver queue (bufferbloat, often hundreds of KB).
  2. The **server kernel's TCP send buffer**. Linux autotunes it up to
     `tcp_wmem` max = 4 MB. `ws.bufferedAmount` doesn't include it.
  3. Only when both are full: `ws.bufferedAmount`. That's the only one
     #95 watches.
- So the 256 KiB skip triggers only after several MB (many seconds) are
  already queued. Measured in the baseline run:

| 1 s samples, phone 1, baseline | t=1 s | t=5 s | t=10 s | t=16 s |
| --- | --- | --- | --- | --- |
| `ws.bufferedAmount` | 0 | 0 | 0 | 0 |
| bytes sent but not yet received by the phone | 1.48 MB | 2.56 MB | 3.87 MB | 5.30 MB |
| staleness of what the phone renders | — | ~5 s | ~9 s | growing |

## Bench setup (`scripts/transport/bench.mjs`)

- A real server (child process) in the `europe-1` room with its default config
  (custom course, field on at 30 Hz), plus **3 desktop clients** (direct
  loopback, cheap CPU) and **2 phone clients**, each in its own process and
  each with a boat.
- Phones are CPU-slow: decode 20 ms per frame, render 15 ms per frame, field
  paint 8 ms. Their WebSocket is read on a worker thread and queued for the
  main thread unbounded, as a browser does. They use the variant under test.
- Phones sit behind a user-space link shaper (`scripts/transport/link.mjs`).
  The box has no `tc netem`: the kernel lacks `sch_netem`, even with sudo.
  - It's a token-bucket bottleneck with a delay line and a drop-tail queue.
  - It freezes ("WiFi stalls") with a probability every 100 ms.
  - For UDP (WebRTC, WebTransport) it also drops packets at random.
  - For TCP the proxy stops reading when its queue is full, so the backlog
    pushes back into the server's kernel buffers like a real bottleneck.
- **Staleness** = wall time when the phone renders a frame minus wall time when
  the server published that tick. Everything runs on one machine, so it's one
  clock. It's collected for every rendered frame over 60 s, after 5 s of
  warm-up.
- Link profiles:
  - **A, "congested phone WiFi":** 3 Mbit/s, 15 ms each way, 256 KB queue,
    2 % chance per 100 ms of a 300 ms stall, 1 % UDP loss.
  - **B, "fair WiFi":** 8 Mbit/s, 20 ms each way, 512 KB queue, 3 % × 400 ms
    stalls, 1 % UDP loss.
- On this 8-core box the server ticks at 23–26 Hz, not 30. The europe-1 sim
  costs ~35 ms per tick here. So absolute KB/s are ~15 % lower than on a
  machine that holds 30 Hz.
- Raw results are in `docs/transport-bench/*.json`.

Run it yourself:

    npm ci
    npm i --no-save node-datachannel@0.33.6 @fails-components/webtransport@1.6.11 @fails-components/webtransport-transport-http3-quiche@1.6.11   # only for rtc / wt
    VARIANT=ws      npm run bench:transport          # send=legacy (main before #197)
    VARIANT=ws-ack  npm run bench:transport          # the default
    VARIANT=rtc-ack npm run bench:transport
    VARIANT=wt      npm run bench:transport
    # link / phone knobs: RATE_KBPS DELAY_MS QUEUE_KB STALL_PCT STALL_MS LOSS_PCT
    #                     DECODE_MS RENDER_MS FIELD_MS ACK_MS DEFLATE=1 DUR_S VERBOSE=1

## Results (60 s per run, 2 phones)

The tables in this section were measured **before** the `field_skip = 1`
default and the owed-field retry, with fields at 30 Hz. "main" there is
today's `send=legacy`. For a re-run with the new defaults, see the next
section.

Staleness is in ms. "render/s" and "field/s" are frames and fields the phone
actually drew. "KB/s" is hot-path bytes the phone received. Server CPU is the
whole server process: one core ≈ 100 %, mostly physics, the same in every run.

**Profile A: congested phone WiFi (3 Mbit/s)**

| variant | query | p50 | p95 | max | render/s | field/s | KB/s | server CPU | desktops p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main (WS, 256 KiB skip) | — | **15 512** | 20 810 | 21 770 | 14.5 | 14.7 | 354 | 96 % | 23 |
| WS, latest-only on `bufferedAmount` ≤ 16 KB | `send=latest` | 15 800 | 23 006 | 24 008 | 14.3 | 14.4 | 348 | 95 % | 23 |
| WS + permessage-deflate (server-wide) | server `--deflate` | 459 | 1 233 | 1 573 | 5.2 | 13.3 | 313 | 111 % | **1 124** |
| **WS + ack window 120 ms** | `send=ack` | **82** | **153** | 568 | 17.3 | 5.1 | 250 | 95 % | 23 |
| WS + ack window 250 ms | `send=ack&ackms=250` | 235 | 325 | 867 | 16.1 | 11.3 | 349 | 99 % | 23 |
| WebRTC DC (unordered, maxRetransmits 0), skip on `bufferedAmount` | `transport=rtc` | 809 | 1 204 | 1 805 | 12.5 | 10.7 | 276 | 103 % | 23 |
| WebRTC DC + ack window | `transport=rtc&send=ack` | 82 | 138 | 667 | 15.4 | 1.8 | 170 | 103 % | 23 |
| WebTransport, 1 stream per message, ≤ 1 in flight per kind | `transport=wt` | 124 | 270 | 560 | 6.6 | 8.6 | 199 | 104 % | 23 |
| WebTransport + ack window | `transport=wt&send=ack` | 110 | 191 | 717 | 11.0 | 1.2 | 169 | 104 % | 23 |

**Profile B: fair WiFi (8 Mbit/s, more and longer stalls)**

| variant | p50 | p95 | max | render/s | field/s | KB/s |
| --- | --- | --- | --- | --- | --- | --- |
| main | 98 | 530 | 1 031 | 14.6 | 14.6 | 569 |
| `send=ack` | 79 | 99 | 693 | 16.6 | 4.8 | 264 |
| `transport=rtc&send=ack` | 86 | 186 | 855 | 15.0 | 1.0 | 162 |
| `transport=wt` | 153 | 458 | 1 046 | 5.1 | 8.2 | 180 |

Reading the tables:

- With enough bandwidth (B), main recovers after each stall, but its p95 is
  0.5 s and it spikes to 1 s. With too little (A), it never recovers. That
  matches the playtest: "unusable within ~30 s".
- `send=ack` keeps the phone at ~80 ms p50 and ~100–150 ms p95 on both links.
  It renders *more* frames than main, because the phone stops wasting CPU and
  bandwidth on frames it would drop anyway.
- The cost is the field: with a 120 ms window the frame always comes first,
  so on a 3 Mbit/s link only ~5 field keyframes per second fit, against
  ~14 on main, which is many seconds late. `ackms=250` gets 11 fields/s back
  at ~235 ms p50.
- The ~80 ms floor is real time: ~33 ms tick slot + 15 ms link + up to
  ~60 ms of phone main-thread time (20 + 15 + 8 ms work per animation frame).
- Max values (0.5–0.9 s) in every variant are the simulated WiFi stalls
  (300–400 ms freezes). No transport can hide those.
- Desktops stay at 22–23 ms in every run except deflate.

### Re-run with the new defaults (`field_skip = 1`, owed-field retry)

These are 60 s runs; raw data is in `docs/transport-bench/defaults-*.json`.
"default" is a page with no query parameters. Staleness is in ms.

| link | variant | p50 / p95 / max | render/s | field/s | phone KB/s | server CPU | desktops p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A (3 Mbit/s) | `send=legacy` | 3257 / 5989 / 6642 (still growing) | 15.2 | 11.2 | 344 | 100 % | 23 |
| A | **default (ack)** | **74 / 105 / 622** | 17.5 | 2.8 | 200 | 101 % | 22 |
| A | `transport=rtc&send=ack` | 81 / 128 / 642 | 15.3 | 1.9 | 165 | 103 % | 23 |
| A | `transport=wt` | 134 / 309 / 692 | 5.9 | 7.9 | 182 | 105 % | 23 |
| B (8 Mbit/s) | `send=legacy` | 89 / 288 / 884 | 15.3 | 11.6 | 382 | 99 % | 23 |
| B | **default (ack)** | **79 / 102 / 711** | 16.2 | 2.3 | 189 | 101 % | 23 |

What changed:

- `field_skip = 1` alone takes legacy on the 3 Mbit/s link from 15.5 s to
  3.3 s p50, but it still grows without bound.
- The ack default holds about 75 ms p50 and about 100 ms p95.
- **The trade-off is the field on CPU-slow phones.** The phone's ~45–60 ms
  of main-thread time per frame delays its acks, so the measured round trip
  stays above the 120 ms target. The window then stays at its 32 KB
  minimum, and only 2–3 fields/s fit, even on 8 Mbit/s.
- `ackms=250` buys the field back: about 11 fields/s at about 235 ms p50 on
  the old 30 Hz field run.
- Desktops and fast clients are unaffected: their window opens fully.
- A follow-up could size the window from the measured minimum round trip
  plus the target, BBR-style, or give each client its own field cadence.

### Why each option behaves as it does

**a. Server-side latest-only on `bufferedAmount` (`send=latest`).** It doesn't
work. `bufferedAmount` only sees ws's user-space queue. The stale data is in
the kernel send buffer and the AP, which can't be inspected or cancelled from
Node: Node can't shrink `SO_SNDBUF` and has no unsent-bytes API. You can only
cap what you put in flight, which is what `send=ack` does.

**a′. End-to-end ack window (`send=ack`).** This is not the server-side
throttle you turned down after #139. That one guessed at slowness from server
state. This is transport-level backpressure.

- The client reports what has arrived. The server keeps at most ~120 ms of
  data in flight, sized from the delivery rate it measures over 1 s
  (×1.25 to keep probing for more).
- The client doesn't change otherwise: #139's newest-frame-only still runs.
- Control, chat, config, admin and statics are never skipped and stay in
  order on the WebSocket. Only frame, field, flow and perf are subject to
  the window.
- Per tick, the frame goes first and the field only if it still fits.
- Upstream it costs one ~25-byte text message per hot message received.
- Desktops on a fast LAN are unaffected: their window opens to its 256 KB
  cap, against ~21 KB per tick.

**b. WebRTC DataChannel** (`node-datachannel` on the server; signalling over
the existing WS: offer, answer, trickle candidates). It works on a LAN with
no STUN or TURN, because the server's host candidate is enough.

- I tested it end to end in Node through the UDP link shaper, with candidates
  rewritten to point at it. In this box's headless Chrome, ICE gathers no
  local candidates at all (sandbox), so it is **not yet verified in a real
  browser**. The browser code uses only standard RTCPeerConnection APIs.
- Unordered with maxRetransmits 0 removes TCP's head-of-line blocking. It does
  **not** remove the queue: SCTP has congestion control and fills the AP
  queue just like TCP. Measured: p50 0.8 s. usrsctp also has its own
  ~1 MiB send buffer, which I cut to 32 KB (without that cut it was 3.3 s).
- Fields are 14 KB, about 12 SCTP fragments. With 1 % packet loss, ~11 % of
  fields are lost entirely. With the ack window on top it matches
  `send=ack`, not better, and gets fewer fields through.

**c. WebTransport** (`@fails-components/webtransport` Http3Server, libquiche
native addon). It's feasible and now supported everywhere:

- caniuse / web-features:
  - Chrome and Chrome Android 97+.
  - Firefox 114+.
  - **Safari and iOS Safari 26.4+ (released 2026-03-24)**, including
    `serverCertificateHashes`.
- Older iPhones that stay below iOS 26.4 can't use it.

Requirements:

- It needs a **secure page**. On a LAN that means serving the game over HTTPS
  (self-signed, with the warning clicked through) and a self-signed ECDSA
  P-256 cert valid < 14 days, passed by hash. The prototype makes one at
  startup (`--https`, `--wt-port`).
- Datagrams max out at ~1200 bytes and frames are 7 KB, so the prototype
  sends **one QUIC unidirectional stream per message**. Older messages never
  block newer ones. The server keeps at most one unfinished stream per kind.
- Checked in headless Chrome against the prototype: the hot path switched to
  WT and frames flowed.
- The bench shows the same story as WebRTC. It's fresher than main, but QUIC
  congestion control plus streams that wait for completion halve the render
  rate (6.6/s). With the ack window it matches `send=ack`.

**d. Cheap wins on WS**

- **Compression:** `scripts/transport/size-study.mjs`, 120 messages each:

| | raw | deflate-1 (per message) | deflate with previous message as dictionary (≈ delta) |
| --- | --- | --- | --- |
| frame | 7.1 KB | 4.4 KB (−38 %), 0.12 ms | 2.5 KB (−65 %) |
| field keyframe | 15.7 KB | 10.8 KB (−31 %), 0.20 ms | 9.2 KB (−41 %) |

- **permessage-deflate (`--deflate`) is the wrong way to get that.**
  - ws compresses separately for every socket.
  - It runs on a shared zlib pool with a concurrency limit, so the queue
    shows up as `bufferedAmount`.
  - In the bench it slowed the server tick (22 Hz against 26 Hz) and pushed
    *desktop* p95 to 1.1 s.
  - The better way is to compress (or delta-encode) once per tick in
    `_publish` and send the same bytes to everyone.
- **Smaller frames:** a delta against the client's last acked frame, or
  quantization of `boats` / `amr` / `hud`, would cut frames by ~2–3×.
  `amr` (2.1 KB) probably changes rarely and could go only on change. Each
  needs a wire v2 (not done here).
- **Lower field rate for slow clients:** fields are ~2/3 of the bytes.
  - Room-wide, `field_skip = 1` already halves the field bandwidth for
    everyone today.
  - Per client, `send=ack` already does this adaptively: frames first,
    fields when there's room.
  - A next step: give each client its own field cadence from its measured
    rate, so a phone gets e.g. 10 fields/s at ~100 ms instead of
    5 at 80 or 11 at 235.

## Comparison

| | staleness on 3 Mbit/s phone (p50 / p95 / max, ms) | per-client bandwidth | server CPU | complexity | mobile browsers | deployment (Coolify + reverse proxy at sailzone.app) |
| --- | --- | --- | --- | --- | --- | --- |
| main | 15 512 / 20 810 / 21 770 (grows without bound) | ~5 Mbit/s demanded | baseline | — | all | as today |
| `send=latest` | 15 800 / 23 006 / 24 008 | same | = | tiny | all | none |
| **`send=ack`** | **82 / 153 / 568** | adapts to the link (2–3 Mbit/s here) | = (+1 tiny text msg per hot msg) | **small: ~150 lines server + client** | **all** | **none: same WS through the proxy** |
| permessage-deflate | 459 / 1 233 / 1 573 (and hurts desktops) | −30–40 % | +15 % | config flag | all | none |
| WebRTC DC + ack | 82 / 138 / 667 | adapts; fields lossy | ≈ = (native SCTP + DTLS) | large: signalling, ICE, native addon | Chrome, Safari, Firefox (iOS 11+) | **UDP: needs host networking or a published UDP port range plus `--rtc-ip`. Coolify's Traefik proxy doesn't forward it. Internet clients behind NAT need STUN and sometimes TURN.** Native `node-datachannel` in the image. |
| WebTransport | 124 / 270 / 560 (+ack: 110 / 191 / 717) | adapts; 6–11 renders/s | ≈ = (libquiche) | large: HTTP/3 server, certs, native addon | Chrome/Android 97+, Safari/iOS **26.4+** | **UDP 443 or another port published from the container. Traefik doesn't proxy WebTransport. Needs a real cert for sailzone.app given to the Node process, or a 14-day rotated self-signed cert.** Native addon in the image. |

## Recommendation

1. **Done in this PR: `send=ack` is the default for WebSocket clients.** It's
   the only change that removes the root cause, it changes nothing for
   desktops on a good link, and it's deployable today. Next steps:
   - Tune `ACK_TARGET_MS`: 120 for the freshest frames, 200–250 for more
     fields.
   - Add a per-client field cadence so phones keep a usable field without
     raising the target.
2. Then cut the bytes, so that slow links get more fields inside the same
   window:
   - Precompress once per tick (−30–40 %), or move to a wire v2 with frame
     deltas against the last acked frame and quantization (frames ~2–3×
     smaller).
   - Done in this PR: `field_skip = 1` is the remote room default.
3. **Don't move to WebRTC or WebTransport for this.** Once flow control is
   in, they give no measurable freshness gain on this traffic. Each brings
   UDP, cert or proxy work on Coolify, plus a native dependency. Revisit
   WebTransport only if you later see head-of-line stalls on lossy links that
   the ack window can't explain (QUIC streams per message do avoid those). By
   then iOS 26.4+ will be most iPhones.

## Try it on a real phone (LAN)

Build and run on the laptop (the phone must be on the same WiFi). Find the
laptop's LAN IP (e.g. `192.168.1.20`).

WebSocket variants (no extra packages, plain http):

    git fetch origin exp/transport && git checkout exp/transport
    npm ci && npm run serve:app          # http://<LAN-IP>:8787

Open on the phone (same room, so one phone can be A and the other B):

- **default (ack window):** `http://192.168.1.20:8787/play/?room=europe-1`
- old behaviour (main before #197): `http://192.168.1.20:8787/play/?room=europe-1&send=legacy`
- ack window, more field: `http://192.168.1.20:8787/play/?room=europe-1&ackms=250`
- latest-only (expected not to help): `…&send=latest`

WebRTC and WebTransport (native packages; WebTransport needs https):

    npm i --no-save node-datachannel@0.33.6 @fails-components/webtransport@1.6.11 @fails-components/webtransport-transport-http3-quiche@1.6.11
    npm run build:app && npm run build:server
    node dist-server/server.mjs --static dist-app --port 8443 --https 192.168.1.20 --wt-port 4433

- Open `https://192.168.1.20:8443/play/?room=europe-1` once and accept the
  certificate warning (Safari: Show Details → visit this website).
- WebRTC: `https://192.168.1.20:8443/play/?room=europe-1&transport=rtc&send=ack`
  (also works without `--https` over plain http).
- WebTransport (Chrome Android, or iOS Safari 26.4+):
  `https://192.168.1.20:8443/play/?room=europe-1&transport=wt`, or
  `…&transport=wt&send=ack`.
- If a channel can't be set up, the page logs a warning and keeps the
  WebSocket.

Watch what the server does per client:

    curl -sk https://192.168.1.20:8443/api/transport   # or http://…:8787/api/transport
    # per client: policy, transport, wsBuffered, inFlight, window, rate (B/s), frames, fields, skips, bytes

Add `&name=phone1` to a page URL to label that client in `/api/transport`.

## Field visualization: bandwidth vs client render

Turning off **Show field (server)** (`field_plane`) on a phone cuts jitter a
lot. That toggle unsubscribes the client, so it stops both the field
keyframes *and* the client decode / paint / draw work. These query
parameters keep one side or the other, so you can tell which cost matters.
They are client-only (not forwarded on the WebSocket) and only apply in
server mode, on sailzone.app or `?host=remote`.

| query | subscription | decode | paint / texture upload | plane |
| --- | --- | --- | --- | --- |
| _(none)_ | on while the box is on | yes | yes | shown while the box is on |
| `field_mode=recv` | on | yes | yes | hidden |
| `field_mode=freeze` | one keyframe, then off | first only | first only | last texture stays visible |
| `field_mode=nopaint` | on | yes | skipped | last texture stays visible (blank until something has been painted) |
| `field_plane=0` | off | no | no | hidden |

The **Show field (server)** checkbox still works: while it is off, the
client unsubscribes and hides the plane, same as today, regardless of
`field_mode`. The experiment mode applies only while the box is on (and
the room is not in dev mode). Reloading with `?field_mode=freeze` stays
subscribed just long enough to paint one keyframe, then unsubscribes.
Unchecking and checking the box again takes a fresh snapshot.

Flow tracers are a **separate** Dev setting (`flow_tracers`, default on,
URL key `?show_field`). Unchecking Show field hides the colour plane but
does **not** unsubscribe if tracers or ladder lines are on: both are
computed on the client from the same vector stream (see below). Add
`show_field=0` (and leave the plane off, and `?ladder=0`) to drop
the stream as well as the per-frame tracer draw.

`?hud=1` shows a small on-screen client readout (not the server `?perf=`
overlay, and not hidden behind backtick / `?dev=1`): the `field_mode` in
use, rAF interval and worst frame in the last 2 s, last field decode and
paint times, `framesDropped` / `fieldsDropped`, frames/s received, and
client / **vector field** KB/s. It updates a few times per second.

On sailzone.app, after this is deployed (same query keys work on a local
`/play/` too):

- Baseline, HUD on: `/play/?room=europe-1&hud=1`
- Receive + paint, hide the plane: `/play/?room=europe-1&hud=1&field_mode=recv`
- One field, then stop sending, keep it visible: `/play/?room=europe-1&hud=1&field_mode=freeze`
- Decode only, skip paint: `/play/?room=europe-1&hud=1&field_mode=nopaint`
- Same four with tracers off: add `&show_field=0`
- Field fully off (current toggle): `/play/?room=europe-1&hud=1&field_plane=0`

If `recv` and `nopaint` still hitch but `freeze` and `field_plane=0` are
smooth, the live field stream (bytes and/or decode) is the cause. If only
`nopaint` and hiding the plane (`recv` / `field_plane=0`) are smooth,
paint and the 5 MB texture upload are the expensive part.


## Vector field wire (speed + direction)

The old remote field keyframe was one contrast-baked, plotType-dependent
palette byte per AMR cell, and flow tracers rode a separate uncompressed
uniform grid (~117 KB, 75×149 float32 u,v at 10 Hz). That flow message
did not fit the default 32 KiB ack window, so tracers vanished on a
phone unless `?send=legacy` was set.

The live remote path now sends **one shared vector keyframe** for every
subscriber:

- Same AMR layout as before (europe-1 default: 50×100 root plus boat
  patches).
- Two bytes per cell: uint8 speed, linear 0..`SPEED_MAX_MPS` (16 m/s,
  which covers the 2f ceiling of 15 m/s; 4f winds above 16 m/s
  saturate), and uint8 direction (256 steps over 360°, downwind
  `atan2(v, u)`). Barrier / hidden use the 254 / 255 sentinels on the
  speed plane. `vmax` is on the message.
- Existing field codec + `encodeWire`, **keyframes only**.
- `WIRE_VERSION` is **2**. An old client against a new server (or the
  reverse) fails with a visible `WireVersionError` / `protocolError`
  ("reload the page"), not silent garbage.

Remote visualization is **speed only**. Density, ux, uy and curl stay
available in the standalone (local / worker) webapp. Contrast is applied
on the client (`1.2^contrastExp`) when painting the speed plane through
the existing JS `paintGrids` path (GPU paint is a follow-up).

The client bilinear-samples the finest covering AMR grid for:

- Flow tracers (`flow_tracers` / `?show_field`)
- Ladder lines, when the per-client Dev setting `ladder_lines` is on
  (default; URL `?ladder=0` turns them off). The existing
  `ladder-lines.js` algorithm is referenced to the local player's next
  course target (start-line mid before the gun, then the next mark or
  the mid of a gate, then the finish-line mid; the same progress as
  the HUD "NEXT" / "NEXT START" logic). The lines lie on the side of
  the target facing the previous point of the leg (previous mark or gate
  mid, the start on the first leg; no lines before the gun),
  one every 10 m for the leg length measured along the wind (at most 40
  lines), and are rebuilt once per field message. Points are clipped to
  the map domain. Old room TOML
  `ladder_lines` keys are ignored. The server no longer computes
  `state.ladder` for remote clients and no longer sends a `flow`
  message.

Subscription: `{ type: 'field', on }`. The server encodes **once** per
due tick (`field_skip`) for every subscriber. The client stays
subscribed while the colour plane, tracers, or ladders need the stream,
and only hides the plane when "Show field (server)" is off.
`?field_mode=recv|freeze|nopaint` still applies to the plane; `freeze`
keeps the last texture but does not drop the stream if tracers or
ladders are on. Fields are owed and retried under the ack window as
before. Tracers work under the default `send=ack` and under
`send=legacy`.

Typical size at default europe-1 (`2f`, `field_skip = 1`, 15 Hz),
measured on a local room with this change (no flow messages):

- 1 boat: **3,810 B/keyframe** at 15.0 Hz → **55.8 KB/s**
- 3 boats: **8,615 B/keyframe** at 14.7 Hz → **124.1 KB/s**

versus the previous colour field (~2,569 B / 5,944 B) **plus** the
uncompressed ~117 KB flow grid at 10 Hz (~1.18–1.23 MB/s per client).
The vector stream is about **20× smaller** than field+flow, and it
fits the 32 KiB ack window.

Phone checks after deploy (europe-1):

- Baseline, HUD on: `/play/?room=europe-1&hud=1`
- Tracers + plane, default ack: `/play/?room=europe-1&hud=1&show_field=1&field_plane=1`
- Tracers, plane off: `/play/?room=europe-1&hud=1&show_field=1&field_plane=0`
- A/B legacy: add `&send=legacy`
- Field-mode experiments: `&field_mode=recv|freeze|nopaint` as above

## Caveats

- **The link is simulated in user space**, because the box kernel has no
  netem. Real WiFi drops and reorders below TCP, and its queues and loss
  patterns differ. The TCP "loss" is modelled as stalls. Trust the direction
  and the order of magnitude. The phone tests above are the real check.
- **The phone CPU model is a fixed busy-wait.** A real phone also has GC
  pauses and thermal throttling, and the browser may pause rAF.
- **Kernel buffer sizes are the box's defaults** (`tcp_wmem` max 4 MB).
  Docker on the sailzone.app host uses the host kernel, so they're likely
  similar there, but I haven't measured it there.
- **The server ran at 23–26 Hz in the bench** (box CPU), not 30 Hz.
- **WebRTC hasn't been verified in a real browser.** This box's headless
  Chrome gathers no ICE candidates. WebTransport and `send=ack` were checked
  in headless Chrome.
- On rtc/wt, statics (text, over the WS) can arrive after the frame that
  needs them, so a course change may show a frame drawn with the old statics.
- `send=ack` over rtc/wt acks the newest seq, and messages not acked within
  500 ms count as lost. On the WS it acks bytes.
- Not touched: Dockerfile, workflows, package.json dependencies. The native
  packages are `--no-save` only. `build:server` marks them external so the
  bundle still builds without them.
