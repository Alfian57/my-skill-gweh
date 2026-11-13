import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fixture } from './helpers.js';
import {
  countScanEntries,
  createScanBudget,
  PROJECT_SCAN_ENTRY_LIMIT,
  readBoundedDirectory,
  readProjectInput,
} from '../dist/project-scan.js';

test('project traversal budget stops at its configured entry limit and reports truncation', () => {
  const budget = createScanBudget();
  assert.equal(countScanEntries(budget, PROJECT_SCAN_ENTRY_LIMIT + 1), PROJECT_SCAN_ENTRY_LIMIT);
  assert.equal(budget.truncated, true);
});

test('directory reads stop at the remaining entry budget and close the stream', async () => {
  const original = fs.opendir;
  let yielded = 0;
  let closed = false;
  fs.opendir = async () => ({
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index < PROJECT_SCAN_ENTRY_LIMIT + 10; index += 1) {
        yielded += 1;
        yield {
          name: String(PROJECT_SCAN_ENTRY_LIMIT + 10 - index).padStart(5, '0'),
          isDirectory: () => false,
        };
      }
    },
    async close() {
      closed = true;
    },
  });
  try {
    const budget = createScanBudget();
    const entries = await readBoundedDirectory('mock-directory', budget);
    assert.equal(entries.length, PROJECT_SCAN_ENTRY_LIMIT);
    assert.equal(yielded, PROJECT_SCAN_ENTRY_LIMIT + 1);
    assert.equal(budget.visited, PROJECT_SCAN_ENTRY_LIMIT);
    assert.equal(budget.truncated, true);
    assert.equal(closed, true);
    assert.deepEqual(
      entries.map(({ name }) => name),
      [...entries.map(({ name }) => name)].sort(),
    );
  } finally {
    fs.opendir = original;
  }
});

test('oversized project input is skipped with a clear size diagnostic', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'package-lock.json');
  const handle = await fs.open(file, 'w');
  await handle.truncate(32 * 1024 * 1024 + 1);
  await handle.close();
  const diagnostics = [];
  assert.equal(await readProjectInput(root, 'package-lock.json', diagnostics), undefined);
  assert.match(diagnostics.join('\n'), /32 MiB project-input limit/u);
});
