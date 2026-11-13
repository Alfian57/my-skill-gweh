import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { applyChanges, inspectLock, LOCK_PATH } from '../dist/transaction.js';
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

test('writer lock records its process identity while a transaction is active', async (t) => {
  const root = await fixture(t);
  const rename = fs.rename.bind(fs);
  let observed;
  t.mock.method(fs, 'rename', async (...args) => {
    observed = await inspectLock(root);
    return rename(...args);
  });
  await applyChanges(root, [{ file: 'new.md', original: undefined, content: 'new' }]);
  assert.equal(observed.state, 'active');
  assert.equal(observed.pid, process.pid);
  assert.ok(observed.startedAt);
  assert.deepEqual(await inspectLock(root), { state: 'none' });
});

test('stale same-host lock reports owner details without deleting the lock automatically', async (t) => {
  const root = await fixture(t);
  const child = spawn(process.execPath, ['-e', '']);
  const pid = child.pid;
  await once(child, 'exit');
  assert.ok(pid);
  await fs.writeFile(
    path.join(root, LOCK_PATH),
    JSON.stringify({ version: 1, pid, host: os.hostname(), startedAt: '2026-01-02T03:04:05.000Z' }),
  );
  assert.equal((await inspectLock(root)).state, 'stale');
  await assert.rejects(
    applyChanges(root, [{ file: 'new.md', original: undefined, content: 'new' }]),
    new RegExp(`stale generation lock.*PID ${pid}.*${LOCK_PATH}`, 'u'),
  );
  assert.ok(await fs.readFile(path.join(root, LOCK_PATH), 'utf8'));
});

test('temporary-file cleanup errors after a successful rename do not leave a false failure', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'existing.md');
  await fs.writeFile(file, 'old');
  t.mock.method(fs, 'rm', async () => {
    throw Object.assign(new Error('Injected cleanup error'), { code: 'EIO' });
  });
  await applyChanges(root, [{ file: 'existing.md', original: 'old', content: 'new' }]);
  assert.equal(await fs.readFile(file, 'utf8'), 'new');
  assert.deepEqual(await fs.readdir(root), ['existing.md']);
  t.mock.restoreAll();
});

test('rollback restores a deleted file when a later write fails', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'obsolete.md'), 'Preserve on rollback');
  const before = await snapshot(root);
  const rename = fs.rename.bind(fs);
  let calls = 0;
  t.mock.method(fs, 'rename', async (...args) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('Injected I/O failure'), { code: 'EIO' });
    return rename(...args);
  });
  await assert.rejects(
    applyChanges(root, [
      { file: 'obsolete.md', original: 'Preserve on rollback', content: undefined },
      { file: 'new/nested/file.md', original: undefined, content: 'New content' },
    ]),
    /Injected I\/O failure/,
  );
  assert.deepEqual(await snapshot(root), before);
});
