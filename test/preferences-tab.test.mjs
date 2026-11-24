// Preferences tab (settings drawer): the old Player tab, without zoom / pan /
// the player name. Name editing lives in the Player menu (#boat_name).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playerPrefIds } from '../src/player-prefs.js';
import { SETTINGS } from '../src/settings-registry.js';
import { SETTINGS_TABS } from '../src/settings-tabs.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function slice(id) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start > 0, id);
  const open = html.lastIndexOf('<div', start);
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = open;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(open, re.lastIndex);
  }
  throw new Error('unclosed ' + id);
}

test('settings tab label is Preferences; internal keys stay player', () => {
  assert.deepEqual(SETTINGS_TABS, ['player', 'dev', 'room']);
  assert.match(html, /id="settings_tab_player"[^>]*>Preferences<\/button>/);
  assert.match(html, /data-tab="player"/);
  assert.match(html, /settings-heading[^>]*>Preferences<\/div>/);
  assert.ok(playerPrefIds().includes('boat_name'));
  assert.ok(playerPrefIds().includes('camera_follow'));
});

test('Preferences pane keeps useful view/controls prefs, drops zoom pan name', () => {
  const player = slice('player_panel');
  assert.match(player, /id="camera_follow"/);
  assert.match(player, /id="show_row_outline"/);
  assert.match(player, /id="touch"/);
  assert.match(player, /id="gamepad"/);
  assert.match(player, /id="vibrate"/);
  assert.match(player, /id="autopilot_drag"/);
  assert.match(player, /id="input_map_group"/);
  assert.doesNotMatch(player, /id="boat_name"/);
  assert.doesNotMatch(player, /camera_zoom_|camera_move_/);
  assert.doesNotMatch(html, /id="own_boat_panel"/);
  assert.doesNotMatch(html, /id="player_menu_name"/);
});

test('boat_name lives once, in the Player menu next to Join', () => {
  const start = html.indexOf('role="group" aria-label="Player menu"');
  assert.ok(start > 0);
  const block = html.slice(start, start + 900);
  assert.match(block, /id="boat_name"/);
  assert.match(block, /id="own_boat_join"/);
  assert.match(block, /id="own_boat_leave"/);
  assert.ok(block.indexOf('id="boat_name"') < block.indexOf('id="own_boat_join"'));
  assert.equal((html.match(/id="boat_name"/g) || []).length, 1);
});

test('Autopilot drag circle preference: Controls group, saved, default on', () => {
  const player = slice('player_panel');
  assert.match(player, /<input id="autopilot_drag" autocomplete="off" type="checkbox"[^>]*>Autopilot drag circle<\/label>/);
  assert.ok(playerPrefIds().includes('autopilot_drag'));
  const s = SETTINGS.find((x) => x.id === 'autopilot_drag');
  assert.equal(s.default, true);
  assert.equal(s.panel, 'player');
});
