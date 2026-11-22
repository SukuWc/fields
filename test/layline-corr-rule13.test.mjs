// Drawn-layline corrections must not share Rule 13's close-hauled gate.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOSE_HAULED_TWA_DEG } from '../src/rules.js';
import { BEST_VMG_DOWNWIND_DEG, BEST_VMG_UPWIND_DEG } from '../src/boat-draw.js';
import { laylineHalfAngleDeg } from '../src/ladder-lines.js';
import { DEV_CONFIG_DEFAULTS } from '../src/dev-config.js';

test('Rule 13 close-hauled stays 40° and is not the layline half-angle', () => {
  assert.equal(CLOSE_HAULED_TWA_DEG, 40);
  assert.equal(BEST_VMG_UPWIND_DEG, 50);
  assert.equal(180 - BEST_VMG_DOWNWIND_DEG, 20);
  assert.notEqual(CLOSE_HAULED_TWA_DEG, BEST_VMG_UPWIND_DEG);
  assert.notEqual(CLOSE_HAULED_TWA_DEG, laylineHalfAngleDeg(1));
  assert.equal(laylineHalfAngleDeg(1, { upwind: 5 }), 55);
  assert.equal(CLOSE_HAULED_TWA_DEG, 40, 'corrections must not mutate Rule 13');
  assert.equal(DEV_CONFIG_DEFAULTS.layline_upwind_corr_deg, 0);
  assert.equal(DEV_CONFIG_DEFAULTS.layline_downwind_corr_deg, 0);
});
