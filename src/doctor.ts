import path from 'node:path';
import { type Config } from './config.js';
import { assertSafePath, readOptional } from './filesystem.js';
import { planGeneration } from './generator.js';
import { renderDocuments } from './render.js';
import { errorMessage } from './errors.js';

export interface DoctorReport {
  missing: string[];
  conflicts: string[];
  drift: string[];
  invalidReferences: { file: string; target: string; reason: string }[];
}

export async function doctor(root: string, config: Config): Promise<DoctorReport> {
  const plan = await planGeneration(root, config);
  const report: DoctorReport = {
    missing: [],
    conflicts: plan.conflicts,
    drift: plan.changes.map(({ file }) => file),
    invalidReferences: [],
  };
  for (const file of Object.keys(renderDocuments(plan.root, config))) {
    const content = await readOptional(await assertSafePath(plan.root, file));
    if (content === undefined) {
      report.missing.push(file);
      continue;
    }
    for (const match of content.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/gu)) {
      const target = match[1];
      if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
      try {
        const decoded = decodeURIComponent(target.split('#')[0] ?? '');
        const relative = path.posix.join(path.posix.dirname(file), decoded);
        const destination = await assertSafePath(plan.root, relative);
        if ((await readOptional(destination)) === undefined)
          throw new Error('Referenced file does not exist.');
      } catch (error) {
        report.invalidReferences.push({ file, target, reason: errorMessage(error) });
      }
    }
  }
  return report;
}

export function isHealthy(report: DoctorReport): boolean {
  return Object.values(report).every((issues) => issues.length === 0);
}
