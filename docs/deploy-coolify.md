# Deploying SailZone on Coolify (sailzone.app)

One container serves everything on one port: the landing page at `/`, the game at
`/play/?room=europe-1`, the WebSocket (same host, `wss://` on https),
`/api/rooms`, `/api/status` and `/healthz`. The image is built from the
`Dockerfile` at the repo root and runs `node dist-server/server.mjs --static dist-app`
as the non-root `node` user, on `PORT` (default 3000).

## 1. DNS

At your DNS provider, create an **A record** for `sailzone.app` that points to the
Coolify server's public IPv4 address. Add an AAAA record if the server has IPv6.
For the optional `www` redirect, also create an A record (or a CNAME to `sailzone.app`)
for `www.sailzone.app`. Wait until `dig +short sailzone.app` returns the server IP,
so the Let's Encrypt certificate can be issued.

## 2. Create the application

In Coolify, in your project/environment, add a new resource of type
application from a **public Git repository**:

- Repository: `https://github.com/SukuWc/fields`
- Branch: `main`
- Build pack: **Dockerfile** (the file at the repo root; base directory `/`)
- Port the container exposes / listens on: **3000**

## 3. Domain

Set the application's domain to `https://sailzone.app`. The `https://` prefix
makes Coolify's proxy (Traefik) request a certificate and redirect http to https.

The proxy forwards WebSocket upgrades as-is. The game connects to
`wss://sailzone.app/ws?room=europe-1` on the same host, so no extra proxy
config or `X-Forwarded-*` handling is needed. The server builds no absolute URLs.

Optional `www`: add `https://www.sailzone.app` as a second domain, and use
Coolify's redirect setting (if your version has one) to send it to the
non-www domain. You can also simply serve both.

## 4. Health check

The image has a Docker `HEALTHCHECK` that requests `/healthz` with node's
`fetch`, so curl is not needed. If you also enable Coolify's own health check, use
path `/healthz`, port `3000`, and expect HTTP 200 with `{"ok":true}`.

## 5. Environment variables (all optional)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` (set in the image) | listen port. If you change it, change the app's port too |
| `ROOMS` | `europe-1` | comma-separated persistent rooms |
| `STATIC_DIR` | `dist-app` | the built site (already passed via `--static`) |

The server binds `0.0.0.0`.

## 6. Auto-deploy on push

Enable automatic deployment for the application. For a public repository, Coolify
can redeploy from a GitHub **webhook**: copy the webhook URL (and secret) that
Coolify shows for the app, then add it in GitHub under
*SukuWc/fields → Settings → Webhooks*, with content type `application/json` and
the *push* event. Alternatively, connect the repo through a GitHub App in
Coolify's sources, which sets up the hooks for you. Each push to `main` then
rebuilds and redeploys.

## 7. Deploy and check

Start the first deployment, then check:

    curl -s https://sailzone.app/healthz      # {"ok":true}
    curl -s https://sailzone.app/api/rooms    # [{"id":"europe-1","players":0}]

Open https://sailzone.app/ and click **Join room**. The landing footer shows
`build <a href="…/commit/<sha>"><short SHA></a>`; `curl -s https://sailzone.app/api/version`
returns `{"commit":"…","sha":"…","url":"https://github.com/SukuWc/fields/commit/…"}`.

**Commit hash on the landing page.** The image has no `.git` directory. The
Dockerfile declares build-args `SOURCE_COMMIT`, `COMMIT_SHA`, and `GIT_COMMIT`
(empty by default). Coolify, for an app built from a git repository, injects
`SOURCE_COMMIT` automatically as a Docker build-arg — you do not need to add a
Build Argument in the UI. `scripts/build-app.mjs` bakes the first non-empty
value (short SHA) into `dist-app/version.json` and the landing footer.

After this fix is deployed, redeploy once: the footer should show
`build <hex>` (for example `build c7e5f79`), not `build dev`. Check with
`curl -s https://sailzone.app/api/version`.

Locally, `npm run build:app` uses `git rev-parse --short HEAD`. A plain
`docker build` without build-args still yields `dev`, which is fine for local
images; to mimic Coolify: `docker build --build-arg SOURCE_COMMIT=<40-hex> .`.

## Notes

- **Redeploys reset room state.** The sim lives in memory. A redeploy or restart
  starts `europe-1` fresh, and connected players are disconnected. They rejoin
  from the landing page or with a reload, and their boats are gone.
- On stop, Docker sends SIGTERM. The server closes the sockets and exits within 5 s.
- Build the image locally with `docker build -t sailzone .`, and run it with
  `docker run --rm -p 3000:3000 sailzone`.
