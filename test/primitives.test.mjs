import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rules = (sel) => [...html.matchAll(new RegExp(`[^{}]*${sel}[^{}]*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);

test('settings, sheet and instrument tabs share .sz-tabs / .sz-tab', () => {
  assert.match(html, /id="settings_tabs" class="sz-tabs"/);
  assert.match(html, /class="sheet-tabs sz-tabs"/);
  assert.match(html, /class="instr-modes sz-tabs"/);
  assert.equal((html.match(/class="settings-tab sz-tab"/g) || []).length, 3);
  assert.match(html, /id="sheet_tab_board" class="sz-tab"/);
  assert.equal((html.match(/class="instr-mode sz-tab"/g) || []).length, 3);
  // No component rule restyles the tab colours or font.
  for (const body of [...rules('\\.settings-tab'), ...rules('\\.sheet-tabs button')]) {
    assert.doesNotMatch(body, /font|background|border-radius/);
  }
});

test('panels and toast chips use .sz-panel / .sz-chip', () => {
  for (const id of ['settings', 'mobile_sheet', 'instrument_panel']) assert.match(html, new RegExp(`id="${id}" class="sz-panel"`));
  const js = readFileSync(new URL('../src/rule-toasts.js', import.meta.url), 'utf8');
  assert.match(js, /class="sz-chip tack-chip port"/);
  assert.match(js, /class="sz-chip tack-chip stbd"/);
});

test('Classic and Overlay touch buttons share .sz-btn font, radius and pressed state', () => {
  const btns = html.match(/<button[^>]*class="[^"]*tc-btn[^"]*"/g);
  assert.equal(btns.length, 9);
  for (const b of btns) assert.match(b, /class="sz-btn tc-btn/);
  for (const body of rules('\\.tc-btn(?![^{]*(?:small|::after))')) assert.doesNotMatch(body, /font-family|border-radius|font-weight/);
  assert.equal(rules('\\.tc-btn\\.pressed').length, 0);
  assert.match(html, /\.sz-btn\.pressed, \.sz-btn:active \{/);
  assert.match(html, /\.bp-touch \.sz-tab \{ min-height: var\(--sz-tap\)/);
  assert.match(html, /\.bp-touch \.sz-btn \{ min-width: var\(--sz-tap\); min-height: var\(--sz-tap\)/);
});
