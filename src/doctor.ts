import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { CONFIG_PATH, MANIFEST_PATH, defaults, loadConfig, type Config } from './config.js';
import { assertSafePath, projectRoot, readOptional, safe } from './filesystem.js';
import { planGeneration } from './generator.js';
import { errorMessage, isFileError } from './errors.js';
import { localMarkdownTargets } from './markdown-links.js';
import { inspectLock, type LockStatus } from './transaction.js';

export interface DoctorReport {
  state: 'initialized' | 'fresh' | 'orphaned' | 'invalid';
  missing: string[];
  conflicts: string[];
  drift: string[];
  orphaned: string[];
  diagnostics: string[];
  invalidReferences: { file: string; target: string; reason: string }[];
  lock: LockStatus;
}

function emptyReport(
  state: DoctorReport['state'],
  diagnostics: string[] = [],
  orphaned: string[] = [],
  lock: LockStatus = { state: 'none' },
): DoctorReport {
  return {
    state,
    missing: [],
    conflicts: [],
    drift: [],
    orphaned,
    diagnostics,
    invalidReferences: [],
    lock,
  };
}

export async function doctor(root: string, input?: Config): Promise<DoctorReport> {
  let base: string;
  try {
    base = await projectRoot(root);
  } catch (error) {
    return emptyReport('invalid', [errorMessage(error)]);
  }
  let lock: LockStatus;
  try {
    lock = await inspectLock(base);
  } catch (error) {
    lock = { state: 'unknown', diagnostic: errorMessage(error) };
  }
  const lockDiagnostic =
    lock.state === 'active'
      ? `Generation is active for PID ${lock.pid}, started ${lock.startedAt}.`
      : lock.state === 'stale'
        ? `Stale generation lock from PID ${lock.pid}, started ${lock.startedAt}; verify it is stopped, then remove .my-skill-gweh.lock.`
        : lock.state === 'unknown'
          ? (lock.diagnostic ?? 'Generation lock state is unknown; inspect .my-skill-gweh.lock.')
          : undefined;

  let configFile: string;
  let manifestFile: string;
  try {
    configFile = await assertSafePath(base, CONFIG_PATH);
    manifestFile = await assertSafePath(base, MANIFEST_PATH);
  } catch (error) {
    return emptyReport(
      'invalid',
      [errorMessage(error), ...(lockDiagnostic ? [lockDiagnostic] : [])],
      [],
      lock,
    );
  }
  const persisted = await readOptional(configFile);
  const persistedManifest = await readOptional(manifestFile);
  let config = input;
  if (!config && persisted !== undefined) {
    try {
      config = await loadConfig(configFile);
    } catch (error) {
      return emptyReport(
        'invalid',
        [errorMessage(error), ...(lockDiagnostic ? [lockDiagnostic] : [])],
        [],
        lock,
      );
    }
  }
  const hasConfig = persisted !== undefined;
  try {
    const plan = await planGeneration(base, config ?? defaults());
    const report: DoctorReport = {
      state: hasConfig
        ? persistedManifest === undefined
          ? 'orphaned'
          : 'initialized'
        : plan.recovered.length ||
            plan.conflictDetails.some(({ kind }) => kind === 'orphan') ||
            plan.conflictDetails.length > 0
          ? 'orphaned'
          : 'fresh',
      missing: [],
      conflicts: plan.conflicts,
      drift: [...plan.changes, ...plan.removals].map(({ file }) => file),
      orphaned: [
        ...new Set([
          ...plan.recovered,
          ...plan.conflictDetails
            .filter(({ kind }) => kind === 'orphan' || (!hasConfig && kind === 'target'))
            .map(({ file }) => file),
        ]),
      ],
      diagnostics: [
        ...(hasConfig && persistedManifest === undefined
          ? ['Ownership manifest is missing; managed files require recovery before update.']
          : []),
        ...(lockDiagnostic ? [lockDiagnostic] : []),
        ...plan.diagnostics,
      ],
      invalidReferences: [],
      lock,
    };
    for (const file of plan.files) {
      const content = await readOptional(await assertSafePath(plan.root, file));
      if (content === undefined) {
        report.missing.push(file);
        continue;
      }
      for (const target of localMarkdownTargets(content)) {
        try {
          const decoded = decodeURIComponent(target.split(/[?#]/u)[0] ?? '');
          const relative = path.posix.join(path.posix.dirname(file), decoded);
          if (!(await referenceExists(plan.root, relative)))
            throw new Error('Referenced file does not exist.');
        } catch (error) {
          report.invalidReferences.push({ file, target, reason: errorMessage(error) });
        }
      }
    }
    return report;
  } catch (error) {
    return emptyReport(
      'invalid',
      [errorMessage(error), ...(lockDiagnostic ? [lockDiagnostic] : [])],
      [],
      lock,
    );
  }
}

export function isHealthy(report: DoctorReport): boolean {
  return (
    report.state === 'initialized' &&
    report.lock.state === 'none' &&
    Object.entries(report).every(([key, value]) =>
      key === 'state' || key === 'lock' ? true : Array.isArray(value) && value.length === 0,
    )
  );
}

async function referenceExists(root: string, relative: string): Promise<boolean> {
  const destination = safe(root, relative);
  const parts = path.relative(root, destination).split(path.sep);
  let current = root;
  try {
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Referenced path contains a symlink.');
      if (index < parts.length - 1 && !stat.isDirectory())
        throw new Error('Referenced parent is not a directory.');
      if (index === parts.length - 1 && !stat.isFile() && !stat.isDirectory())
        throw new Error('Referenced path is not a file or directory.');
    }
    return true;
  } catch (error) {
    if (isFileError(error, 'ENOENT')) return false;
    throw error;
  }
}
