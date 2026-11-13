import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unifiedDiff } from '../dist/cli/diff.js';

test('interactive conflict diff shows aligned context and only changed sections', () => {
  const diff = unifiedDiff('one\ntwo\nold\nfour\nfive', 'one\ntwo\nnew\nfour\nfive');
  assert.match(diff, /^--- current\n\+\+\+ proposed/mu);
  assert.match(diff, /-old/u);
  assert.match(diff, /\+new/u);
  assert.doesNotMatch(diff, /-one|\+one/u);
});

test('oversized conflict diff is explicitly omitted instead of showing misleading lines', () => {
  const content = Array.from({ length: 1200 }, (_, index) => `line ${index}`).join('\n');
  assert.match(unifiedDiff(content, `${content}\nnew`), /Diff omitted: file is too large/u);
});
