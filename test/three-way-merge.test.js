import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTextThreeWayDetailed, resolveThreeWayMerge } from '../dist/three-way-merge.js';

test('three-way merge combines independent edits, including insertions at a replacement boundary', () => {
  const result = mergeTextThreeWayDetailed(
    'first\nsecond\nthird',
    'first\nsecond\nlocal note\nthird',
    'first\ngenerated second\nthird',
  );
  assert.deepEqual(result, {
    kind: 'merged',
    text: 'first\ngenerated second\nlocal note\nthird',
  });
});

test('overlapping edits form independent hunks and resolve local, generated, and both choices', () => {
  const merge = mergeTextThreeWayDetailed(
    'alpha\nbase one\nmiddle\nbase two\nomega',
    'alpha\nlocal one\nmiddle\nlocal two\nomega',
    'alpha\ngenerated one\nmiddle\ngenerated two\nomega',
  );
  assert.equal(merge.kind, 'conflicts');
  if (merge.kind !== 'conflicts') return;
  assert.equal(merge.hunks.length, 2);
  const result = resolveThreeWayMerge(merge, {
    [merge.hunks[0].id]: 'both',
    [merge.hunks[1].id]: 'generated',
  });
  assert.equal(result, 'alpha\nlocal one\n\ngenerated one\nmiddle\ngenerated two\nomega');
});

test('identical edits do not conflict and incomplete hunk choices cannot resolve a merge', () => {
  const same = mergeTextThreeWayDetailed('a\nb', 'a\nshared', 'a\nshared');
  assert.deepEqual(same, { kind: 'merged', text: 'a\nshared' });

  const conflict = mergeTextThreeWayDetailed('a\nb', 'a\nlocal', 'a\ngenerated');
  assert.equal(conflict.kind, 'conflicts');
  if (conflict.kind === 'conflicts') assert.equal(resolveThreeWayMerge(conflict, {}), undefined);
});

test('quadratic work is rejected before allocating an excessive comparison table', () => {
  const large = Array.from({ length: 1500 }, (_, index) => `line ${index}`).join('\n');
  const result = mergeTextThreeWayDetailed(large, `${large}\nlocal`, `${large}\ngenerated`);
  assert.equal(result.kind, 'limit');
});
