import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { assertSafePath, readOptional, safe } from './filesystem.js';
import { isFileError } from './errors.js';

export interface FileChange {
  file: string;
  original: string | undefined;
  content: string | undefined;
}

export const LOCK_PATH = '.my-skill-gweh.lock';

export interface LockStatus {
  state: 'none' | 'active' | 'stale' | 'unknown';
  pid?: number;
  host?: string;
  startedAt?: string;
  diagnostic?: string;
}

export async function inspectLock(root: string): Promise<LockStatus> {
  const file = safe(root, LOCK_PATH);
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (isFileError(error, 'ENOENT')) return { state: 'none' };
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      state: 'unknown',
      diagnostic: 'Lock path is not a regular file; inspect it manually.',
    };
  }
  let lock: unknown;
  try {
    lock = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  } catch {
    return { state: 'unknown', diagnostic: 'Lock metadata is unreadable; inspect it manually.' };
  }
  if (
    typeof lock !== 'object' ||
    lock === null ||
    !('pid' in lock) ||
    typeof lock.pid !== 'number' ||
    !Number.isInteger(lock.pid) ||
    lock.pid < 1 ||
    !('host' in lock) ||
    typeof lock.host !== 'string' ||
    !('startedAt' in lock) ||
    typeof lock.startedAt !== 'string'
  ) {
    return { state: 'unknown', diagnostic: 'Lock metadata is incomplete; inspect it manually.' };
  }
  const metadata = lock as { pid: number; host: string; startedAt: string };
  if (metadata.host !== os.hostname()) {
    return {
      state: 'unknown',
      ...metadata,
      diagnostic: 'Lock belongs to another host; verify its owner before removal.',
    };
  }
  try {
    process.kill(metadata.pid, 0);
    return { state: 'active', ...metadata };
  } catch (error) {
    if (isFileError(error, 'ESRCH')) return { state: 'stale', ...metadata };
    if (isFileError(error, 'EPERM')) return { state: 'active', ...metadata };
    return {
      state: 'unknown',
      ...metadata,
      diagnostic: 'Could not determine whether the lock owner is active.',
    };
  }
}

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
  let renamed = false;
  try {
    await handle.writeFile(content, 'utf8');
    await handle.close();
    await fs.rename(temporary, destination);
    renamed = true;
  } finally {
    if (!renamed) {
      await handle.close().catch(() => undefined);
      await fs.rm(temporary, { force: true }).catch((error: unknown) => {
        if (!isFileError(error, 'ENOENT')) throw error;
      });
    }
  }
}

/** Atomic per-file replacements with rollback on ordinary I/O failures. */
export async function applyChanges(
  root: string,
  changes: FileChange[],
  beforeEachWrite?: (file: string) => Promise<void>,
): Promise<void> {
  if (!changes.length) return;
  const lockPath = safe(root, LOCK_PATH);
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (error) {
    if (isFileError(error, 'EEXIST')) {
      const status = await inspectLock(root);
      if (status.state === 'active')
        throw new Error(
          `Another generation is active (PID ${status.pid}, started ${status.startedAt}).`,
        );
      if (status.state === 'stale')
        throw new Error(
          `A stale generation lock remains (PID ${status.pid}, started ${status.startedAt}). Verify that process is stopped, then remove ${LOCK_PATH}.`,
        );
      throw new Error(
        `Another generation may be running. ${status.diagnostic ?? `Inspect ${LOCK_PATH} before removing it.`}`,
      );
    }
    throw error;
  }
  try {
    await lock.writeFile(
      JSON.stringify({
        version: 1,
        pid: process.pid,
        host: os.hostname(),
        startedAt: new Date().toISOString(),
        token: randomUUID(),
      }) + '\n',
      'utf8',
    );
    await lock.sync();
  } catch (error) {
    await lock.close().catch(() => undefined);
    await fs.unlink(lockPath).catch(() => undefined);
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
      await beforeEachWrite?.(change.file);
      const file = await assertSafePath(root, change.file);
      if ((await readOptional(file)) !== change.original) {
        throw new Error(`File changed since preview: ${change.file}`);
      }
      if (change.content === undefined) {
        await fs.unlink(file);
      } else {
        await createParents(root, path.dirname(file), created);
        if ((await readOptional(await assertSafePath(root, change.file))) !== change.original) {
          throw new Error(`File changed since preview: ${change.file}`);
        }
        await assertSafePath(root, change.file);
        await replaceFile(root, change.file, change.content);
      }
      applied.push(change);
    }
  } catch (error) {
    const failures: unknown[] = [];
    for (const change of applied.reverse()) {
      try {
        const current = await readOptional(await assertSafePath(root, change.file));
        if (current !== change.content) {
          throw new Error(
            `Rollback skipped because the file changed during generation: ${change.file}`,
          );
        }
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
    await lock.close().catch(() => undefined);
    await fs.unlink(lockPath).catch((error: unknown) => {
      if (!isFileError(error, 'ENOENT'))
        process.emitWarning(`Could not remove ${LOCK_PATH}: ${String(error)}`);
    });
  }
}
