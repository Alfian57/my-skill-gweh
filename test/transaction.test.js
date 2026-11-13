import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { applyChanges, LOCK_PATH } from '../dist/transaction.js';
import { fixture, snapshot } from './helpers.js';

test('a write failure restores previous content and removes temporary files and created directories', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'existing.md'), 'Original');
  const before = await snapshot(root);
  const rename = fs.rename.bind(fs);
  let calls = 0;
  t.mock.method(fs, 'rename', async (...args) => {
    calls += 1;
    if (calls === 2) throw Object.assign(new Error('Injected I/O failure'), { code: 'EIO' });
    return rename(...args);
  });
  await assert.rejects(
    applyChanges(root, [
      { file: 'existing.md', original: 'Original', content: 'Updated' },
      { file: 'new/nested/file.md', original: undefined, content: 'New content' },
    ]),
    /Injected I\/O failure/,
  );
  assert.deepEqual(await snapshot(root), before);
  assert.deepEqual(await fs.readdir(root), ['existing.md']);
});

test('an existing lock prevents concurrent writers without touching project files', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, LOCK_PATH), 'Another process');
  const before = await snapshot(root);
  await assert.rejects(
    applyChanges(root, [{ file: 'new.md', original: undefined, content: 'New content' }]),
    /Another generation/,
  );
  assert.deepEqual(await snapshot(root), before);
});
