// Which SimHost the page uses (main.js), from the query string and the
// build-time defaults (VITE_SIM_HOST, VITE_SIM_SERVER_URL).
//   ?host=worker | local | remote   explicit choice
//   ?worker=0                       main thread (kept from phase 4; = host=local)
//   ?server=ws://host:port/?room=x  server for host=remote
// The build default is the worker (VITE_SIM_HOST unset). A worker choice
// without Worker support becomes local. Params equal to the build default
// are listed in drop, so the URL only carries non-default values.
export const DEFAULT_SERVER_URL = 'ws://localhost:8787';
const KINDS = ['worker', 'local', 'remote'];

export function hostChoice(search, { hasWorker = true, envHost, envServer } = {}) {
  const q = new URLSearchParams(search);
  const buildDefault = KINDS.includes(envHost) ? envHost : 'worker';
  const asked = q.get('host');
  let kind = KINDS.includes(asked) ? asked : (q.get('worker') === '0' ? 'local' : buildDefault);
  if (kind === 'worker' && !hasWorker) kind = 'local';
  const drop = [];
  if (q.get('worker') === '1') drop.push('worker');
  if (asked && asked === buildDefault) drop.push('host');
  const serverDefault = envServer || DEFAULT_SERVER_URL;
  if (q.has('server') && q.get('server') === serverDefault) drop.push('server');
  return { kind, server: kind === 'remote' ? (q.get('server') || serverDefault) : null, drop };
}
