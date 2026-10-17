// Boat readout (#info). Lines are collected as one HTML string during a sim
// callback and written to the DOM once, in flushInfo(). Writing with
// `innerHTML +=` per line made the browser re-serialize and re-parse the
// whole readout about twenty times per callback, which churned through
// hundreds of thousands of short-lived DOM nodes.

let html = '';
let written = null;

// Start a new readout (the first line a boat writes each step).
export function setInfo(text) {
  html = text;
}

export function appendInfo(text) {
  html += text;
}

// Write the readout if it changed since the last flush.
export function flushInfo() {
  if (html === written) return;
  const el = typeof document !== 'undefined' && document.getElementById('info');
  if (!el) return;
  el.innerHTML = html;
  written = html;
}

// Boat readout lines from Boat.telemetry (boat.js), in the order and format
// the boat used to write them itself. A key the step did not reach is skipped.
export function boatTelemetryHtml(t) {
  let h = '';
  if (t.depowered) h += '<b>DEPOWERED</b><br>';
  if ('autopilot' in t) h += 'Autopilot' + t.autopilot + '<br>';
  if ('headingTarget' in t) h += 'Heading Target' + t.headingTarget + '<br>';
  if ('qd' in t) h += 'q/d: ' + t.qd + '°<br>';
  if ('error' in t) h += 'error: ' + Math.floor(t.error) + '°<br>';
  if ('twa' in t) h += 'TWA: ' + Math.floor(t.twa) + '<br>';
  if ('tws' in t) h += 'TWS: ' + Math.floor(t.tws * 10) / 10 + ' m/s<br>';
  if ('awa' in t) h += 'AWA: ' + Math.floor(t.awa) + '<br>';
  if ('aws' in t) h += 'AWS: ' + Math.floor(t.aws * 10) / 10 + '<br>';
  if ('bs' in t) h += 'BS: ' + Math.floor(t.bs * 10) / 10 + '<br>';
  if ('vmg' in t) h += 'VMG: ' + Math.floor(t.vmg * 10) / 10 + '<br>';
  if ('cd' in t) h += 'Cd: ' + Math.floor(t.cd * 10) / 10 + '<br>';
  if ('cl' in t) h += 'Cl: ' + Math.floor(t.cl * 10) / 10 + '<br>';
  if ('power' in t) h += 'Power: ' + Math.floor(t.power * 10) / 10 + '<br>';
  return h;
}
