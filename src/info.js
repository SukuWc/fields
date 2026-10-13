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
