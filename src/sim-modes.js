// Simulation resolution modes (#simRes / ?simRes), the default and each
// mode's wind ceiling. No engine imports, so the page can use it. Fast-wind
// options ("2f", "4f") use a coarse root cell but step it every frame:
// stepsPerFrame is explicit, see Boltzmann._build. ?simRes values not listed
// here (e.g. the removed "2f34") fall back to DEFAULT_SIM_RES.
export const SIM_RES_MODES = {
  '1': { resolution: 1 }, '2': { resolution: 0.5 }, '4': { resolution: 0.25 },
  '2f': { resolution: 0.5, stepsPerFrame: 1 },
  // 4 m root cell stepped once per 30 Hz tick (velScale 4, x4 ring layout,
  // 5 levels down to 1/8 m). Selectable with ?simRes=4f.
  '4f': { resolution: 0.25, stepsPerFrame: 1 },
};
// App and engine default: 2 m root stepped once per tick (velScale 2, 4
// refinement levels down to 1/8 m, stable to 15 m/s ≈ 29 kn).
export const DEFAULT_SIM_RES = '2f';

// Stable wind ceiling of a mode in m/s: lattice U 0.25 = 0.25 · cell · 30 ·
// stepsPerFrame = 7.5 m/s · velScale (1 m / x2 / x4 7.5, 2f 15,
// 4f 30). The wind command clamps to it.
export function windCeilingMps(mode) {
  const m = SIM_RES_MODES[mode] || SIM_RES_MODES[DEFAULT_SIM_RES];
  return 7.5 * (1 / m.resolution) * (m.stepsPerFrame ?? m.resolution);
}

