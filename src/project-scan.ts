import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import { assertSafePath } from './filesystem.js';
import { isFileError } from './errors.js';

export const PROJECT_SCAN_ENTRY_LIMIT = 20_000;
export const PROJECT_SCAN_DEPTH_LIMIT = 64;
export const PROJECT_INPUT_SIZE_LIMIT = 32 * 1024 * 1024;

export interface ScanBudget {
  visited: number;
  truncated: boolean;
  diagnostics: string[];
}

export function createScanBudget(): ScanBudget {
  return { visited: 0, truncated: false, diagnostics: [] };
}

export function countScanEntries(budget: ScanBudget, count: number): number {
  const remaining = PROJECT_SCAN_ENTRY_LIMIT - budget.visited;
  const accepted = Math.max(0, Math.min(count, remaining));
  budget.visited += accepted;
  if (accepted < count) budget.truncated = true;
  return accepted;
}

/** Read at most the remaining scan budget, retaining deterministic ordering with bounded memory. */
export async function readBoundedDirectory(
  directory: string,
  budget: ScanBudget,
): Promise<Dirent[]> {
  const handle = await fs.opendir(directory);
  const entries: Dirent[] = [];
  const remaining = PROJECT_SCAN_ENTRY_LIMIT - budget.visited;
  try {
    for await (const entry of handle) {
      if (entries.length >= remaining) {
        budget.truncated = true;
        break;
      }
      entries.push(entry);
    }
  } finally {
    await handle.close().catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ERR_DIR_CLOSED'))
        throw error;
    });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  budget.visited += entries.length;
  return entries;
}

export function scanDiagnostics(budget: ScanBudget): string[] {
  return [
    ...budget.diagnostics,
    ...(budget.truncated
      ? [
          `Project scan stopped after ${PROJECT_SCAN_ENTRY_LIMIT} entries or depth ${PROJECT_SCAN_DEPTH_LIMIT}; detected context may be incomplete.`,
        ]
      : []),
  ];
}

/** Read project input without following symlinks or loading unexpectedly large manifests. */
export async function readProjectInput(
  root: string,
  relative: string,
  diagnostics: string[],
): Promise<string | undefined> {
  let file: string;
  try {
    file = await assertSafePath(root, relative);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('symlink')) {
      diagnostics.push(
        `Skipped symlinked project input ${relative}; inputs outside the project are not read.`,
      );
      return undefined;
    }
    throw error;
  }

  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (isFileError(error, 'ENOENT')) return undefined;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    diagnostics.push(`Skipped non-regular project input ${relative}.`);
    return undefined;
  }
  if (stat.size > PROJECT_INPUT_SIZE_LIMIT) {
    diagnostics.push(
      `Skipped ${relative}; its size exceeds the ${PROJECT_INPUT_SIZE_LIMIT / (1024 * 1024)} MiB project-input limit.`,
    );
    return undefined;
  }
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (isFileError(error, 'ENOENT')) return undefined;
    throw error;
  }
}
