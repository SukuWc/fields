import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUICK_MESSAGES } from '../src/chat-panel.js';
import { QUICK_MESSAGES as SHEET_QUICK } from '../src/mobile-sheet.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('one chat shell: quick messages live in #chat_body on every size', () => {
  assert.equal(SHEET_QUICK, QUICK_MESSAGES);
  const body = html.match(/<div id="chat_body"[\s\S]*?<div id="chat_status"/)[0];
  assert.match(body, /id="chat_log"[\s\S]*id="chat_quick"[\s\S]*id="chat_form"/);
  assert.doesNotMatch(html, /sheet_quick|sheet-quick/);
  assert.match(html, /id="chat_body" class="sz-panel"/);
  assert.match(html, /id="chat_toggle" class="sz-btn"/);
  assert.match(html, /id="chat_send" class="sz-btn"/);
});

test('one badge style: chat unread and the sheet badges use .sz-badge', () => {
  assert.match(html, /id="chat_unread" class="sz-badge"/);
  assert.equal((html.match(/class="st-badge sz-badge"/g) || []).length, 2);
  assert.doesNotMatch(html, /#chat_unread \{[^}]*background/);
  assert.doesNotMatch(html, /\.st-badge \{[^}]*background/);
  assert.doesNotMatch(html, /#e33/);
});
