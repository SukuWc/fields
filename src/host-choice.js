// Which SimHost the page uses (main.js), from the query string and the
// build-time defaults (VITE_SIM_HOST, VITE_SIM_SERVER_URL).
//   ?host=worker | local | remote   explicit choice
//   ?worker=0                       main thread (kept from phase 4; = host=local)
//   ?server=ws://host:port/?room=x  server for host=remote
// The build default is the worker (VITE_SIM_HOST unset). A worker choice
// without Worker support becomes local. Params equal to the build default
// are listed in drop, so the URL only carries non-default values.
// VITE_SIM_SERVER_URL=same-origin (npm run build:app, the page the Node server
// serves at /play/) means ws(s)://<page host>/ws?room=<?room=, default
// europe-1>, wss on an https page.
export const DEFAULT_SERVER_URL = 'ws://localhost:8787';
export const DEFAULT_ROOM = 'europe-1';
const KINDS = ['worker', 'local', 'remote'];

export function hostChoice(search, { hasWorker = true, envHost, envServer, loc } = {}) {
  const q = new URLSearchParams(search);
  const buildDefault = KINDS.includes(envHost) ? envHost : 'worker';
  const asked = q.get('host');
  let kind = KINDS.includes(asked) ? asked : (q.get('worker') === '0' ? 'local' : buildDefault);
  if (kind === 'worker' && !hasWorker) kind = 'local';
  const drop = [];
  if (q.get('worker') === '1') drop.push('worker');
  if (asked && asked === buildDefault) drop.push('host');
  let serverDefault = envServer || DEFAULT_SERVER_URL;
  if (serverDefault === 'same-origin') {
    const l = loc || { protocol: 'http:', host: 'localhost:8787' };
    serverDefault = `${l.protocol === 'https:' ? 'wss' : 'ws'}://${l.host}/ws?room=${encodeURIComponent(q.get('room') || DEFAULT_ROOM)}`;
  }
  if (q.has('server') && q.get('server') === serverDefault) drop.push('server');
  return { kind, server: kind === 'remote' ? (q.get('server') || serverDefault) : null, drop };
}
