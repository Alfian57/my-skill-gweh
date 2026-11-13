import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import { isFileError, isRecord } from './errors.js';
import { readOptional, safe } from './filesystem.js';
import type { Detection } from './detection.js';
import { stackCatalog, type StackTechnology } from './stack.js';
import { BEGIN_MARKER, END_MARKER } from './managed-content.js';
import {
  createScanBudget,
  PROJECT_SCAN_ENTRY_LIMIT,
  PROJECT_SCAN_DEPTH_LIMIT,
  readBoundedDirectory,
  readProjectInput,
  scanDiagnostics,
  type ScanBudget,
} from './project-scan.js';

interface Localized {
  id: string;
  en: string;
}

export interface ProjectFact {
  label: Localized;
  value: string;
  source: string;
}

export interface DeclaredCommand {
  manager: string;
  name: string;
  invocation: string;
}

export interface ProjectArea {
  label: Localized;
  paths: string[];
}

export interface ProjectContext {
  name?: string;
  stack: string[];
  detectedStack: string[];
  packageManager?: string;
  packageManagerEvidence: string[];
  packageManagerAmbiguous: boolean;
  packageManagerConflict?: string;
  ecosystems: string[];
  sourceEvidence: string[];
  facts: ProjectFact[];
  commands: DeclaredCommand[];
  areas: ProjectArea[];
  instructions: string[];
  existingSkills: string[];
  diagnostics: string[];
  uiEvidence: boolean;
  nextRouter: 'app' | 'pages' | 'mixed' | 'unknown';
}

const excludedDirectories = new Set([
  '.git',
  '.my-skill-gweh',
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.next',
  'coverage',
  'storage',
  'target',
  '.turbo',
  '.cache',
  '.output',
  '.svelte-kit',
  '.vercel',
  'out',
]);

const areaDefinitions: Array<{ label: Localized; roots: string[] }> = [
  {
    label: { id: 'Aplikasi dan source', en: 'Application and source' },
    roots: ['app', 'src', 'internal', 'cmd', 'resources'],
  },
  {
    label: { id: 'Route dan controller', en: 'Routes and controllers' },
    roots: ['routes', 'router', 'routers', 'app/Http/Controllers', 'src/routes'],
  },
  {
    label: { id: 'Model dan schema data', en: 'Models and data schema' },
    roots: [
      'app/Models',
      'models',
      'database/migrations',
      'migrations',
      'prisma',
      'internal/model',
    ],
  },
  {
    label: { id: 'Tes', en: 'Tests' },
    roots: ['tests', 'test', '__tests__'],
  },
  {
    label: { id: 'Build dan operasi', en: 'Build and operations' },
    roots: ['docker', 'deployment', 'deploy', '.github/workflows', 'scripts'],
  },
];

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseJsonObject(
  raw: string | undefined,
  filename: string,
  diagnostics: string[],
): Record<string, unknown> {
  if (raw === undefined) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      diagnostics.push(
        `Invalid JSON in ${filename}; expected an object, so its facts were skipped.`,
      );
      return {};
    }
    return parsed;
  } catch (error) {
    diagnostics.push(
      `Invalid JSON in ${filename}; facts from this file were skipped${error instanceof Error ? ` (${error.message})` : ''}.`,
    );
    return {};
  }
}

async function jsonFile(
  root: string,
  filename: string,
  diagnostics: string[],
): Promise<Record<string, unknown>> {
  return parseJsonObject(
    await readProjectInput(root, filename, diagnostics),
    filename,
    diagnostics,
  );
}

function addFact(
  facts: ProjectFact[],
  label: Localized,
  value: string | undefined,
  source: string,
): void {
  if (value) facts.push({ label, value, source });
}

function commandsFrom(manager: string | undefined, scripts: unknown): DeclaredCommand[] {
  const argument = (name: string): string =>
    /^[A-Za-z0-9_:@./+-]+$/u.test(name) ? name : `'${name.replaceAll("'", "'\\''")}'`;
  return (
    Object.keys(record(scripts))
      // Composer lifecycle hooks run as part of install/update events, not as project tasks.
      .filter((name) => manager !== 'composer' || !/^(?:pre|post)-/iu.test(name))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({
        manager: manager === 'composer' ? 'composer' : (manager ?? 'package.json'),
        name,
        invocation: manager
          ? `${manager} ${argument(name)}`
          : `script ${JSON.stringify(name)} (package manager not identified)`,
      }))
  );
}

async function exists(root: string, relative: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(safe(root, relative));
    return !stat.isSymbolicLink() && (stat.isDirectory() || stat.isFile());
  } catch {
    return false;
  }
}

async function containsUserInstructions(root: string, relative: string): Promise<boolean> {
  const content = await readOptional(safe(root, relative));
  if (content === undefined) return false;
  const begin = content.indexOf(BEGIN_MARKER);
  const end = content.indexOf(END_MARKER);
  if (begin < 0 || end < begin) return true;
  let outside = `${content.slice(0, begin)}${content.slice(end + END_MARKER.length)}`;
  outside = outside.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '');
  return outside.trim().length > 0;
}

function isGeneratedPath(relative: string, output: string): boolean {
  const normalized = relative.split(path.sep).join('/');
  return normalized === output || normalized.startsWith(`${output}/`);
}

async function collectPaths(
  root: string,
  relative: string,
  limit: number,
  output: string,
  budget: ScanBudget,
): Promise<string[]> {
  const found: string[] = [];
  if (isGeneratedPath(relative, output)) return found;
  const pending: Array<{ relative: string; depth: number }> = [{ relative, depth: 0 }];
  let cursor = 0;
  while (
    cursor < pending.length &&
    found.length < limit &&
    budget.visited < PROJECT_SCAN_ENTRY_LIMIT &&
    !budget.truncated
  ) {
    const item = pending[cursor++];
    if (!item) continue;
    const { relative: current, depth } = item;
    let entries;
    try {
      entries = await readBoundedDirectory(safe(root, current), budget);
    } catch (error) {
      if (isFileError(error, 'EACCES') || isFileError(error, 'EPERM'))
        budget.diagnostics.push(`Skipped unreadable repository directory ${current}.`);
      continue;
    }
    for (const entry of entries) {
      const child = path.posix.join(current.split(path.sep).join('/'), entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name.toLowerCase()) && !isGeneratedPath(child, output)) {
          if (depth >= PROJECT_SCAN_DEPTH_LIMIT) budget.truncated = true;
          else pending.push({ relative: child, depth: depth + 1 });
        }
      } else if (entry.isFile() && !/^\.env(?:\.|$)/iu.test(entry.name)) {
        found.push(child);
        if (found.length >= limit) break;
      }
    }
  }
  if (cursor < pending.length && budget.visited >= PROJECT_SCAN_ENTRY_LIMIT)
    budget.truncated = true;
  return found;
}

async function collectAreas(
  root: string,
  output: string,
  budget: ScanBudget,
): Promise<ProjectArea[]> {
  const areas: ProjectArea[] = [];
  for (const definition of areaDefinitions) {
    const paths: string[] = [];
    for (const candidate of definition.roots) {
      if (isGeneratedPath(candidate, output)) continue;
      if (!(await exists(root, candidate))) continue;
      const stat = await fs.lstat(safe(root, candidate));
      if (stat.isFile()) {
        paths.push(candidate);
      } else {
        paths.push(
          ...(await collectPaths(root, candidate, Math.max(1, 3 - paths.length), output, budget)),
        );
      }
      if (paths.length >= 3) break;
    }
    if (paths.length)
      areas.push({ label: definition.label, paths: [...new Set(paths)].slice(0, 3) });
  }
  return areas;
}

async function collectGuidance(
  root: string,
  output: string,
  budget: ScanBudget,
): Promise<{ instructions: string[]; skills: string[] }> {
  const instructionFiles = [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    'CODEX.md',
    '.github/copilot-instructions.md',
    '.cursor/rules',
    '.windsurf/rules',
  ];
  const instructions: string[] = [];
  for (const candidate of instructionFiles) {
    if (!(await exists(root, candidate))) continue;
    if (candidate.endsWith('/rules')) {
      const files = await collectPaths(root, candidate, 10, output, budget);
      for (const file of files) {
        if (await containsUserInstructions(root, file)) instructions.push(file);
      }
    } else {
      if (await containsUserInstructions(root, candidate)) instructions.push(candidate);
    }
  }

  const skills: string[] = [];
  for (const directory of [
    '.agents/skills',
    '.claude/skills',
    '.codex/skills',
    '.cursor/skills',
    '.github/skills',
    '.windsurf/skills',
  ]) {
    if (!(await exists(root, directory))) continue;
    for (const file of await collectPaths(root, directory, 30, output, budget)) {
      if (!file.endsWith('/SKILL.md') || file.includes('/my-skill-gweh-')) continue;
      skills.push(file);
      if (skills.length >= 24) return { instructions, skills };
    }
  }
  return { instructions, skills };
}

function selectedDependencies(
  stack: readonly string[],
): Array<{ technology: StackTechnology; name: string }> {
  const dependencies: Array<{ technology: StackTechnology; name: string }> = [];
  for (const technology of stack) {
    switch (technology as StackTechnology) {
      case 'laravel':
        dependencies.push({ technology: 'laravel', name: 'laravel/framework' });
        break;
      case 'nextjs':
        dependencies.push({ technology: 'nextjs', name: 'next' });
        break;
      case 'react':
        dependencies.push({ technology: 'react', name: 'react' });
        break;
      case 'typescript':
        dependencies.push({ technology: 'typescript', name: 'typescript' });
        break;
      case 'inertia':
        dependencies.push({ technology: 'inertia', name: '@inertiajs/react' });
        break;
      default:
        break;
    }
  }
  return [...new Map(dependencies.map((item) => [item.name, item])).values()];
}

export async function collectProjectContext(
  root: string,
  config: Config,
  detection: Detection,
): Promise<ProjectContext> {
  const diagnostics = [...(detection.diagnostics ?? [])];
  const budget = createScanBudget();
  const composer = await jsonFile(root, 'composer.json', diagnostics);
  const composerLockRaw = await readProjectInput(root, 'composer.lock', diagnostics);
  const composerLock = parseJsonObject(composerLockRaw, 'composer.lock', diagnostics);
  const packageJson = await jsonFile(root, 'package.json', diagnostics);
  const packageLockRaw =
    detection.packageManager === 'npm'
      ? await readProjectInput(root, 'package-lock.json', diagnostics)
      : undefined;
  const npmLockAvailable = packageLockRaw !== undefined;
  const packageLock = parseJsonObject(packageLockRaw, 'package-lock.json', diagnostics);
  const facts: ProjectFact[] = [];
  const stack = [...config.stack];
  const composerName = stringValue(composer.name);
  const packageName = stringValue(packageJson.name);
  let projectName = composerName ?? packageName;

  const phpRequirement = stringValue(record(composer.require).php);
  addFact(facts, { id: 'Kebutuhan PHP', en: 'PHP requirement' }, phpRequirement, 'composer.json');

  const lockPackages = [
    ...(Array.isArray(composerLock.packages) ? composerLock.packages : []),
    ...(Array.isArray(composerLock['packages-dev']) ? composerLock['packages-dev'] : []),
  ];
  const composerVersions = new Map<string, string>();
  for (const item of lockPackages) {
    const dependency = record(item);
    const name = stringValue(dependency.name);
    const version = stringValue(dependency.version);
    if (name && version) composerVersions.set(name, version);
  }

  const composerDependencies = {
    ...record(composer.require),
    ...record(composer['require-dev']),
  };
  const npmDependencies = {
    ...record(packageJson.dependencies),
    ...record(packageJson.devDependencies),
  };
  for (const { technology, name } of selectedDependencies(stack)) {
    const composerDependency = Object.hasOwn(composerDependencies, name);
    const requested = stringValue(
      (composerDependency ? composerDependencies : npmDependencies)[name],
    );
    const locked = composerDependency
      ? composerVersions.get(name)
      : stringValue(
          record(record(packageLock.packages)[`node_modules/${name}`]).version ??
            record(record(packageLock.dependencies)[name]).version,
        );
    const value = [requested, locked ? `lock: ${locked}` : undefined].filter(Boolean).join(' · ');
    const label = stackCatalog[technology].label;
    addFact(
      facts,
      { id: `Dependency ${label.id}`, en: `Dependency ${label.en}` },
      value,
      composerDependency
        ? `composer.json${composerLockRaw === undefined ? '' : ' / composer.lock'}`
        : `package.json${npmLockAvailable ? ' / package-lock.json' : ''}`,
    );
  }

  const managerPrefix = detection.packageManager
    ? ({ npm: 'npm run', pnpm: 'pnpm run', yarn: 'yarn run', bun: 'bun run' } as const)[
        detection.packageManager
      ]
    : undefined;
  const npmScripts = commandsFrom(managerPrefix, packageJson.scripts);
  const composerScripts = commandsFrom('composer', composer.scripts);
  const commands = [...composerScripts, ...npmScripts];
  const goMod = await readProjectInput(root, 'go.mod', diagnostics);
  if (goMod) {
    const moduleName = /^\s*module\s+(\S+)/mu.exec(goMod)?.[1];
    const goVersion = /^\s*go\s+(\S+)/mu.exec(goMod)?.[1];
    if (!projectName && moduleName) projectName = moduleName;
    addFact(facts, { id: 'Modul Go', en: 'Go module' }, moduleName, 'go.mod');
    addFact(facts, { id: 'Versi Go', en: 'Go version' }, goVersion, 'go.mod');
  }

  const guidance = await collectGuidance(root, config.output, budget);
  return {
    ...(projectName ? { name: projectName } : {}),
    stack,
    detectedStack: detection.stack,
    ...(detection.packageManager ? { packageManager: detection.packageManager } : {}),
    packageManagerEvidence: detection.packageManagerEvidence ?? [],
    packageManagerAmbiguous: detection.packageManagerAmbiguous ?? false,
    ...(detection.packageManagerConflict
      ? { packageManagerConflict: detection.packageManagerConflict }
      : {}),
    ecosystems: detection.ecosystems,
    sourceEvidence: detection.sourceEvidence,
    facts,
    commands,
    areas: await collectAreas(root, config.output, budget),
    instructions: guidance.instructions,
    existingSkills: guidance.skills,
    diagnostics: [...diagnostics, ...scanDiagnostics(budget)],
    uiEvidence: detection.uiEvidence ?? false,
    nextRouter: await detectNextRouter(root),
  };
}

async function detectNextRouter(root: string): Promise<ProjectContext['nextRouter']> {
  const appFiles = [
    'app/page.js',
    'app/page.jsx',
    'app/page.ts',
    'app/page.tsx',
    'app/page.mjs',
    'app/page.mts',
    'src/app/page.js',
    'src/app/page.jsx',
    'src/app/page.ts',
    'src/app/page.tsx',
    'app/layout.js',
    'app/layout.jsx',
    'app/layout.ts',
    'app/layout.tsx',
    'src/app/layout.js',
    'src/app/layout.jsx',
    'src/app/layout.ts',
    'src/app/layout.tsx',
  ];
  const pagesFiles = [
    'pages/_app.js',
    'pages/_app.jsx',
    'pages/_app.ts',
    'pages/_app.tsx',
    'pages/index.js',
    'pages/index.jsx',
    'pages/index.ts',
    'pages/index.tsx',
    'src/pages/_app.js',
    'src/pages/_app.jsx',
    'src/pages/_app.ts',
    'src/pages/_app.tsx',
    'src/pages/index.js',
    'src/pages/index.jsx',
    'src/pages/index.ts',
    'src/pages/index.tsx',
  ];
  const app = (await Promise.all(appFiles.map((file) => exists(root, file)))).some(Boolean);
  const pages = (await Promise.all(pagesFiles.map((file) => exists(root, file)))).some(Boolean);
  if (app && pages) return 'mixed';
  if (app) return 'app';
  if (pages) return 'pages';
  return 'unknown';
}
