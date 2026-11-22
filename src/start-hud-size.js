// Race timer size for the phone toast stack (index.html "Mobile toast
// placement"). The timer (#start_hud) grows with the race lifecycle line
// (#236) and the restart vote row (#238), so a fixed offset under it let rule
// toasts cover the vote button. This publishes on <body>:
// - --start-hud-h: the timer's current height (0 when hidden),
// - --scenario-card-b: the bottom edge of the scenario card (0 when hidden),
//   which sits under the minimap on phones (#231),
// so portrait phones can stack the toasts below whichever ends lower.
export function startHudVars(doc) {
  const sh = doc.getElementById('start_hud');
  const card = doc.getElementById('scenario_card');
  const shown = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  return {
    h: shown(sh) ? Math.round(sh.getBoundingClientRect().height) : 0,
    cardB: shown(card) ? Math.round(card.getBoundingClientRect().bottom) : 0,
  };
}

export function setupStartHudSize(doc = document, win = typeof window !== 'undefined' ? window : null) {
  const body = doc.body;
  const publish = () => {
    const v = startHudVars(doc);
    body.style.setProperty('--start-hud-h', v.h + 'px');
    body.style.setProperty('--scenario-card-b', v.cardB + 'px');
  };
  if (win && typeof win.ResizeObserver === 'function') {
    const ro = new win.ResizeObserver(publish);
    for (const id of ['start_hud', 'scenario_card', 'minimap']) { const el = doc.getElementById(id); if (el) ro.observe(el); }
  }
  if (win) win.addEventListener('resize', publish);
  publish();
  return { publish };
}
