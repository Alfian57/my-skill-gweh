import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isFileError, isRecord } from './errors.js';
import {
  createScanBudget,
  PROJECT_SCAN_DEPTH_LIMIT,
  PROJECT_SCAN_ENTRY_LIMIT,
  readBoundedDirectory,
  readProjectInput,
  scanDiagnostics,
  type ScanBudget,
} from './project-scan.js';
import { stackTechnologies, type StackTechnology } from './stack.js';

export interface Detection {
  stack: string[];
  evidence: string[];
  commands: Record<string, string>;
  ecosystems: string[];
  sourceEvidence: string[];
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
  packageManagerEvidence?: string[];
  packageManagerAmbiguous?: boolean;
  packageManagerConflict?: string;
  uiEvidence?: boolean;
  diagnostics?: string[];
}

const packageLockManagers = new Map<string, Detection['packageManager']>([
  ['package-lock.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]);

function managerFromPackageJson(value: unknown): Detection['packageManager'] | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(npm|pnpm|yarn|bun)@/u.exec(value);
  return match?.[1] as Detection['packageManager'];
}

const ignoredDirectories = new Set([
  '.git',
  '.my-skill-gweh',
  'node_modules',
  'vendor',
  'storage',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
  '.output',
  '.svelte-kit',
  '.vercel',
  'out',
  'target',
]);

const sourceLanguages: Readonly<Record<string, StackTechnology>> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.php': 'php',
  '.go': 'go',
};

async function scanSources(
  root: string,
  budget: ScanBudget,
): Promise<{ languages: Set<StackTechnology>; extensions: Set<string>; uiEvidence: boolean }> {
  const languages = new Set<StackTechnology>();
  const extensions = new Set<string>();
  const pending: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  let uiEvidence = false;

  while (pending.length && budget.visited < PROJECT_SCAN_ENTRY_LIMIT && !budget.truncated) {
    const current = pending.pop();
    if (!current) continue;
    const { directory, depth } = current;
    let entries;
    try {
      entries = await readBoundedDirectory(directory, budget);
    } catch (error) {
      if (directory !== root && isFileError(error, 'ENOENT')) {
        continue;
      }
      if (directory !== root && (isFileError(error, 'EACCES') || isFileError(error, 'EPERM'))) {
        budget.diagnostics.push(
          `Skipped unreadable source directory ${path.relative(root, directory)}.`,
        );
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name.toLowerCase())) {
          if (depth >= PROJECT_SCAN_DEPTH_LIMIT) budget.truncated = true;
          else pending.push({ directory: path.join(directory, entry.name), depth: depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      const language = sourceLanguages[extension];
      if (language) {
        languages.add(language);
        extensions.add(extension);
      }
      const relative = path
        .relative(root, path.join(directory, entry.name))
        .split(path.sep)
        .join('/');
      if (
        ['.jsx', '.tsx', '.vue', '.html'].includes(extension) ||
        /(?:^|\/)resources\/(?:js|views)(?:\/|$)/u.test(relative)
      )
        uiEvidence = true;
    }
  }

  if (pending.length && budget.visited >= PROJECT_SCAN_ENTRY_LIMIT) budget.truncated = true;

  return { languages, extensions, uiEvidence };
}

function stringMap(value: unknown, field: string, file: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid ${field} in ${file}: expected an object of strings.`);
  }
  return value as Record<string, string>;
}

function manifest(raw: string, file: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}`, { cause: error });
  }
  if (!isRecord(value))
    throw new Error(`Invalid project manifest in ${file}: expected a JSON object.`);
  return value;
}

export async function detect(root: string): Promise<Detection> {
  const stack = new Set<StackTechnology>();
  const evidence: string[] = [];
  const ecosystems: string[] = [];
  const budget = createScanBudget();
  const diagnostics: string[] = [];
  const sources = await scanSources(root, budget);
  for (const language of sources.languages) stack.add(language);
  let commands: Record<string, string> = {};
  let declaredPackageManager: Detection['packageManager'];

  for (const filename of ['package.json', 'composer.json', 'go.mod']) {
    const file = path.join(root, filename);
    const raw = await readProjectInput(root, filename, diagnostics);
    if (raw === undefined) continue;
    evidence.push(filename);

    if (filename === 'go.mod') {
      ecosystems.push('go-modules');
      const uncommented = raw.replace(/\/\/.*$/gmu, '');
      if (/^\s*(?:require\s+)?github\.com\/gin-gonic\/gin\s+v\S+/mu.test(uncommented))
        stack.add('gin');
      continue;
    }

    let data: Record<string, unknown>;
    try {
      data = manifest(raw, file);
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (filename === 'package.json') {
      ecosystems.push('javascript-packages');
      const dependencies = {
        ...stringMap(data.dependencies, 'dependencies', file),
        ...stringMap(data.devDependencies, 'devDependencies', file),
      };
      for (const [dependency, name] of [
        ['react', 'react'],
        ['next', 'nextjs'],
        ['@inertiajs/react', 'inertia'],
      ] as const) {
        if (Object.hasOwn(dependencies, dependency)) stack.add(name);
      }
      commands = stringMap(data.scripts, 'scripts', file);
      declaredPackageManager = managerFromPackageJson(data.packageManager);
    } else {
      ecosystems.push('composer');
      const dependencies = {
        ...stringMap(data.require, 'require', file),
        ...stringMap(data['require-dev'], 'require-dev', file),
      };
      if (Object.hasOwn(dependencies, 'laravel/framework')) stack.add('laravel');
    }
  }

  const packageManagerEvidence: string[] = [];
  if (declaredPackageManager) packageManagerEvidence.push('package.json#packageManager');
  const lockFiles: string[] = [];
  for (const lockFile of packageLockManagers.keys()) {
    try {
      const file = path.join(root, lockFile);
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) {
        diagnostics.push(
          `Skipped symlinked lockfile ${lockFile}; inputs outside the project are not read.`,
        );
      } else if (stat.isFile()) {
        lockFiles.push(lockFile);
      }
    } catch (error) {
      if (!isFileError(error, 'ENOENT')) throw error;
    }
  }
  packageManagerEvidence.push(...lockFiles);
  const detectedManagers = [...new Set(lockFiles.map((file) => packageLockManagers.get(file)))];
  const packageManagerConflict =
    declaredPackageManager && detectedManagers.some((manager) => manager !== declaredPackageManager)
      ? `package.json declares ${declaredPackageManager}, but lockfiles indicate ${detectedManagers.join(', ')}`
      : undefined;
  const packageManager =
    declaredPackageManager ?? (detectedManagers.length === 1 ? detectedManagers[0] : undefined);

  return {
    stack: stackTechnologies.filter((technology) => stack.has(technology)),
    evidence,
    commands,
    ecosystems,
    sourceEvidence: [...sources.extensions].sort(),
    ...(packageManager ? { packageManager } : {}),
    ...(packageManagerEvidence.length ? { packageManagerEvidence } : {}),
    ...(!declaredPackageManager && detectedManagers.length > 1
      ? { packageManagerAmbiguous: true }
      : {}),
    ...(packageManagerConflict ? { packageManagerConflict } : {}),
    ...(sources.uiEvidence ? { uiEvidence: true } : {}),
    diagnostics: [...diagnostics, ...scanDiagnostics(budget)],
  };
}
