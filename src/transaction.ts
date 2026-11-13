import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertSafePath, readOptional, safe } from './filesystem.js';
import { isFileError } from './errors.js';

export interface FileChange {
  file: string;
  original: string | undefined;
  content: string;
}

export const LOCK_PATH = '.my-skill-gweh.lock';

async function createParents(root: string, directory: string, created: string[]): Promise<void> {
  const parent = path.dirname(directory);
  if (directory === root) return;
  if (parent !== root) await createParents(root, parent, created);
  try {
    await fs.mkdir(directory);
    created.push(directory);
  } catch (error) {
    if (!isFileError(error, 'EEXIST')) throw error;
  }
}

async function replaceFile(root: string, file: string, content: string): Promise<void> {
  const destination = await assertSafePath(root, file);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const stat = await fs.stat(destination).catch((error: unknown) => {
    if (isFileError(error, 'ENOENT')) return undefined;
    throw error;
  });
  const handle = await fs.open(temporary, 'wx', stat ? stat.mode & 0o777 : 0o666);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.close();
    await fs.rename(temporary, destination);
  } finally {
    await handle.close();
    await fs.rm(temporary, { force: true });
  }
}

/** Atomic per-file replacements with rollback on ordinary I/O failures. */
export async function applyChanges(root: string, changes: FileChange[]): Promise<void> {
  if (!changes.length) return;
  const lockPath = safe(root, LOCK_PATH);
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (error) {
    if (isFileError(error, 'EEXIST'))
      throw new Error(
        'Another generation is running, or a stale .my-skill-gweh.lock needs removal.',
      );
    throw error;
  }
  const created: string[] = [];
  const applied: FileChange[] = [];
  try {
    // Validate every snapshot before the first write, including metadata.
    for (const change of changes) {
      const file = await assertSafePath(root, change.file);
      if ((await readOptional(file)) !== change.original) {
        throw new Error(`File changed since preview: ${change.file}`);
      }
    }
    for (const change of changes) {
      const file = await assertSafePath(root, change.file);
      await createParents(root, path.dirname(file), created);
      await assertSafePath(root, change.file);
      await replaceFile(root, change.file, change.content);
      applied.push(change);
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const change of applied.reverse()) {
      try {
        if (change.original === undefined) await fs.unlink(await assertSafePath(root, change.file));
        else await replaceFile(root, change.file, change.original);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    for (const directory of created.reverse()) {
      try {
        await fs.rmdir(directory);
      } catch (cleanupError) {
        if (!isFileError(cleanupError, 'ENOTEMPTY') && !isFileError(cleanupError, 'ENOENT'))
          failures.push(cleanupError);
      }
    }
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        'Generation failed and rollback was incomplete.',
      );
    throw error;
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}
