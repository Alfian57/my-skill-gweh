import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BASELINE_PATH,
  CONFIG_PATH,
  MANIFEST_PATH,
  STATE_DIRECTORY,
  parseConfig,
  type Config,
} from './config.js';
import { assertSafePath, projectRoot, readOptional, safe } from './filesystem.js';
import { isFileError, isRecord } from './errors.js';
import { renderDocuments, localLink, type Document } from './render.js';
import { collectProjectContext } from './project-context.js';
import { detect } from './detection.js';
import {
  fingerprint,
  BEGIN_MARKER,
  END_MARKER,
  managedPayload,
  managedContentFingerprint,
  retainManagedContent,
  removeManagedContent,
  replaceManagedContent,
  verifiedManagedFingerprint,
} from './managed-content.js';
import { applyChanges, LOCK_PATH, type FileChange } from './transaction.js';
import { skillIds } from './catalog.js';
import { projectGuidePath, skillGuidePath } from './render.js';
import {
  createScanBudget,
  PROJECT_SCAN_ENTRY_LIMIT,
  PROJECT_SCAN_DEPTH_LIMIT,
  readBoundedDirectory,
  scanDiagnostics,
} from './project-scan.js';
import {
  mergeTextThreeWayDetailed,
  resolveThreeWayMerge,
  type MergeChoice,
  type MergeHunk,
} from './three-way-merge.js';
import { relocateMarkdownLinks } from './markdown-links.js';

export type GenerationStatus = 'preview' | 'applied' | 'partial' | 'blocked' | 'cancelled';

export interface GenerationResult {
  /** Compatibility field: paths whose contents are scheduled for a write. */
  changes: string[];
  /** Compatibility field: paths that still need a user resolution. */
  conflicts: string[];
  conflictDetails: GenerationConflict[];
  recovered: string[];
  status: GenerationStatus;
  planned: {
    writes: string[];
    removals: string[];
    backups: string[];
    metadata: string[];
  };
  written: string[];
  removed: string[];
  skipped: string[];
  backups: string[];
  diagnostics: string[];
}

export interface GenerationConflict {
  file: string;
  reason: string;
  kind: 'target' | 'stale' | 'orphan' | 'merge' | 'limit' | 'nested';
  reasonCode?:
    'unowned' | 'ownership' | 'overlap' | 'work-limit' | 'modified-removal' | 'nested-project';
  existing?: string;
  proposed?: string;
  archivePath?: string;
  merge?: {
    baseFingerprint: string;
    localFingerprint: string;
    generatedFingerprint: string;
    hunks: MergeHunk[];
  };
}

export interface GenerationPlan {
  root: string;
  files: string[];
  changes: FileChange[];
  removals: FileChange[];
  backups: FileChange[];
  metadata: FileChange[];
  conflicts: string[];
  conflictDetails: GenerationConflict[];
  removed: string[];
  skipped: string[];
  recovered: string[];
  diagnostics: string[];
}

export interface GenerationDecisions {
  replace?: string[];
  skip?: string[];
  retain?: string[];
  delete?: string[];
  hunks?: Record<
    string,
    {
      baseFingerprint: string;
      localFingerprint: string;
      generatedFingerprint: string;
      choices: Record<string, MergeChoice>;
    }
  >;
  resolutions?: Record<
    string,
    { action: 'replace' | 'retain' | 'delete' | 'skip'; snapshot: string }
  >;
}

const ignoredScanDirectories = new Set([
  '.git',
  '.my-skill-gweh',
  'node_modules',
  'vendor',
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
  'storage',
]);

async function loadManifest(root: string): Promise<Record<string, string>> {
  const file = await assertSafePath(root, MANIFEST_PATH);
  const raw = await readOptional(file);
  if (raw === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}`, { cause: error });
  }
  if (!isRecord(value)) throw new Error('Manifest must be an object of file fingerprints.');
  for (const [relative, hash] of Object.entries(value)) {
    safe(root, relative);
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash)) {
      throw new Error(`Invalid manifest fingerprint: ${relative}`);
    }
  }
  return value as Record<string, string>;
}

async function loadBaselines(root: string): Promise<Record<string, string>> {
  const file = await assertSafePath(root, BASELINE_PATH);
  const raw = await readOptional(file);
  if (raw === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}`, { cause: error });
  }
  if (!isRecord(value))
    throw new Error('Baseline state must be an object of generated guide bodies.');
  for (const [relative, body] of Object.entries(value)) {
    safe(root, relative);
    if (typeof body !== 'string') throw new Error(`Invalid guide baseline: ${relative}`);
  }
  return value as Record<string, string>;
}

async function hasNestedProjectBoundary(root: string, relative: string): Promise<boolean> {
  if (!relative) return false;
  for (const marker of ['.git', `${STATE_DIRECTORY}/config.json`]) {
    try {
      await fs.lstat(safe(root, `${relative}/${marker}`));
      return true;
    } catch (error) {
      if (!isFileError(error, 'ENOENT')) {
        if (error instanceof Error && error.message.includes('symlink')) return true;
        throw error;
      }
    }
  }
  return false;
}

async function scanManagedFiles(
  root: string,
): Promise<{ files: Array<{ file: string; content: string }>; diagnostics: string[] }> {
  const found: Array<{ file: string; content: string }> = [];
  const budget = createScanBudget();
  const pending: Array<{ relative: string; depth: number }> = [{ relative: '', depth: 0 }];
  let fileLimitReached = false;
  while (
    pending.length &&
    found.length < 500 &&
    budget.visited < PROJECT_SCAN_ENTRY_LIMIT &&
    !budget.truncated
  ) {
    const current = pending.pop();
    if (!current) continue;
    const { relative: relativeDirectory, depth } = current;
    const directory = relativeDirectory ? safe(root, relativeDirectory) : root;
    let entries;
    try {
      entries = await readBoundedDirectory(directory, budget);
    } catch (error) {
      if (isFileError(error, 'ENOENT')) continue;
      if (isFileError(error, 'EACCES') || isFileError(error, 'EPERM')) {
        budget.diagnostics.push(
          `Skipped unreadable managed-file directory ${relativeDirectory || '.'}.`,
        );
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ignoredScanDirectories.has(entry.name.toLowerCase())) continue;
        if (depth >= PROJECT_SCAN_DEPTH_LIMIT) {
          budget.truncated = true;
          break;
        }
        if (!(await hasNestedProjectBoundary(root, relative)))
          pending.push({ relative, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile() || !/\.(?:md|mdc)$/iu.test(entry.name)) continue;
      try {
        const file = await assertSafePath(root, relative);
        const stat = await fs.stat(file);
        if (stat.size > 1_000_000) continue;
        const content = await readOptional(file);
        if (content && (content.includes(BEGIN_MARKER) || content.includes(END_MARKER))) {
          found.push({ file: relative, content });
        }
      } catch {
        // Ignore unreadable or unsafe paths during this read-only recovery scan.
      }
      if (found.length >= 500) {
        fileLimitReached = true;
        break;
      }
    }
  }
  if (pending.length && budget.visited >= PROJECT_SCAN_ENTRY_LIMIT) budget.truncated = true;
  const diagnostics = scanDiagnostics(budget);
  if (fileLimitReached)
    diagnostics.push(
      'Managed-file recovery stopped after 500 files; additional managed files were not inspected.',
    );
  return { files: found, diagnostics };
}

function knownLegacyPointerFingerprint(file: string, content: string): string | undefined {
  const frontmatter =
    file === '.cursor/rules/my-skill-gweh.mdc'
      ? '---\nalwaysApply: true\n---\n'
      : file === '.windsurf/rules/my-skill-gweh.md'
        ? '---\ntrigger: always_on\n---\n'
        : '';
  const supported = new Set([
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.cursor/rules/my-skill-gweh.mdc',
    '.github/copilot-instructions.md',
    '.windsurf/rules/my-skill-gweh.md',
  ]);
  if (!supported.has(file)) return undefined;

  const normalized = content.replace(/\r\n?/gu, '\n');
  for (const language of ['en', 'id'] as const) {
    for (const output of ['docs', 'ai-agent-docs']) {
      const english = language === 'en';
      const contexts = [
        { context: `${output}/project-context.md`, workflow: `${output}/workflow.md` },
        { context: `${output}/project/context.md`, workflow: `${output}/project/workflow.md` },
      ];
      for (const paths of contexts) {
        const body = english
          ? `Before editing, read the [engineering guidelines](${localLink(file, `${output}/README.md`)}), [project context map](${localLink(file, paths.context)}), and [workflow](${localLink(file, paths.workflow)}). Then open the relevant skill guide linked from the index. Follow more specific repository instructions where they apply.`
          : `Sebelum mengedit, baca [panduan engineering](${localLink(file, `${output}/README.md`)}), [peta konteks proyek](${localLink(file, paths.context)}), dan [workflow](${localLink(file, paths.workflow)}). Lalu buka panduan skill terkait dari index. Ikuti instruksi repository yang lebih spesifik bila berlaku.`;
        const concise = english
          ? `Start with the [index](${localLink(file, `${output}/README.md`)}); read only the relevant skill guide. Open project context or workflow when the task needs them. For database work, ask whether production may be reset: if yes, edit existing migrations; if no, add a data-preserving migration. Follow more specific repository instructions.`
          : `Mulai dari [index](${localLink(file, `${output}/README.md`)}); baca hanya panduan skill yang relevan. Buka peta konteks atau workflow bila tugas membutuhkannya. Untuk tugas database, tanyakan apakah production boleh di-fresh: jika boleh, edit migrasi yang ada; jika tidak, tambahkan migrasi yang menjaga data. Ikuti instruksi repository yang lebih spesifik.`;
        for (const candidate of [body, concise]) {
          const expected = `${frontmatter}${BEGIN_MARKER}\n${candidate}\n${END_MARKER}\n`;
          if (normalized === expected) return managedContentFingerprint(content);
        }
      }
    }
  }
  return undefined;
}

function backupChange(file: string, original: string): FileChange {
  return {
    file: `${STATE_DIRECTORY}/backups/${randomUUID()}/${file}`,
    original: undefined,
    content: original,
  };
}

function addBackup(backups: FileChange[], file: string, original: string): void {
  if (backups.some((item) => item.file.endsWith(`/${file}`) && item.content === original)) return;
  backups.push(backupChange(file, original));
}

function legacyGuideDestination(output: string, file: string): string | undefined {
  if (file === `${output}/project-context.md`) return projectGuidePath(output, 'context');
  if (file === `${output}/workflow.md`) return projectGuidePath(output, 'workflow');
  const prefix = `${output}/`;
  if (!file.startsWith(prefix) || file.slice(prefix.length).includes('/')) return undefined;
  const name = path.posix.basename(file, '.md');
  return (skillIds as readonly string[]).includes(name)
    ? skillGuidePath(output, name as (typeof skillIds)[number])
    : undefined;
}

function appendMigratedNotes(
  document: Document,
  notes: string,
  source: string,
  language: Config['docsLanguage'],
): Document {
  const title =
    language === 'en' ? 'Developer notes migrated from' : 'Catatan developer dipindahkan dari';
  return {
    ...document,
    body: `${document.body.trimEnd()}\n\n## ${title} \`${source}\`\n\n${notes.trim()}\n`,
  };
}

function retainedPath(output: string, file: string, content: string): string {
  const prefix = `${output}/`;
  const relative = file.startsWith(prefix) ? file.slice(prefix.length) : `agent-files/${file}`;
  const extension = path.posix.extname(relative);
  const stem = extension ? relative.slice(0, -extension.length) : relative;
  return `${output}/retained/${stem}.retained-${fingerprint(content).slice(0, 12)}.md`;
}

function retainedContent(
  original: string,
  file: string,
  destination: string,
  root: string,
): string {
  const body = retainManagedContent(original);
  return relocateMarkdownLinks(body, root, file, destination);
}

async function isWithinNestedProject(root: string, relativeFile: string): Promise<boolean> {
  const parts = relativeFile.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    if (await hasNestedProjectBoundary(root, parts.slice(0, index).join('/'))) return true;
  }
  return false;
}

function isCanonicalGuide(output: string, file: string): boolean {
  return (
    (file.startsWith(`${output}/engineering/`) || file.startsWith(`${output}/application/`)) &&
    file.endsWith('.md')
  );
}

function addConflict(
  conflicts: GenerationConflict[],
  file: string,
  reason: string,
  kind: GenerationConflict['kind'],
  existing?: string,
  proposed?: string,
  extra: Partial<GenerationConflict> = {},
): void {
  conflicts.push({
    file,
    reason,
    kind,
    ...(existing !== undefined ? { existing } : {}),
    ...(proposed !== undefined ? { proposed } : {}),
    ...extra,
  });
}

function contentSnapshot(content: string | undefined): string {
  return content === undefined ? 'missing' : fingerprint(content);
}

export async function planGeneration(
  root: string,
  input: Config,
  decisions: GenerationDecisions = {},
  detectedInput?: Awaited<ReturnType<typeof detect>>,
): Promise<GenerationPlan> {
  const config = parseConfig(input);
  const base = await projectRoot(root);
  if (config.output.split('/')[0] === LOCK_PATH)
    throw new Error('Output conflicts with the generation lock.');
  if (await isWithinNestedProject(base, `${config.output}/README.md`)) {
    const reason =
      'The configured output is inside a nested project. Run the CLI from that child project root.';
    const conflict: GenerationConflict = {
      file: config.output,
      reason,
      kind: 'nested',
      reasonCode: 'nested-project',
    };
    return {
      root: base,
      files: [],
      changes: [],
      removals: [],
      backups: [],
      metadata: [],
      conflicts: [config.output],
      conflictDetails: [conflict],
      removed: [],
      skipped: [],
      recovered: [],
      diagnostics: [],
    };
  }
  const detection = detectedInput ?? (await detect(base));
  const context = await collectProjectContext(base, config, detection);
  const documents = { ...renderDocuments(base, config, detection, context) };
  const generatedBodies = new Map(
    Object.entries(documents).map(([file, document]) => [
      file,
      document.body.replace(/\r\n?/gu, '\n').replace(/\n+$/u, ''),
    ]),
  );
  const previous = await loadManifest(base);
  const previousBaselines = await loadBaselines(base);
  const baselines = { ...previousBaselines };
  const manifest = { ...previous };
  const changes: FileChange[] = [];
  const removals: FileChange[] = [];
  const backups: FileChange[] = [];
  const conflictDetails: GenerationConflict[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];
  const diagnostics: string[] = [...context.diagnostics];
  const replace = new Set(decisions.replace ?? []);
  const skip = new Set(decisions.skip ?? []);
  const retained = new Set(decisions.retain ?? []);
  const deleted = new Set(decisions.delete ?? []);
  for (const [file, resolution] of Object.entries(decisions.resolutions ?? {})) {
    if (resolution.action === 'skip') skip.add(file);
  }
  const actionFor = (
    file: string,
    original: string | undefined,
  ): 'replace' | 'retain' | 'delete' | 'skip' | undefined => {
    if (Object.hasOwn(decisions.resolutions ?? {}, file)) {
      const resolution = decisions.resolutions?.[file];
      return resolution?.snapshot === contentSnapshot(original) ? resolution.action : undefined;
    }
    if (replace.has(file)) return 'replace';
    if (retained.has(file)) return 'retain';
    if (deleted.has(file)) return 'delete';
    if (skip.has(file)) return 'skip';
    return undefined;
  };
  const scan = await scanManagedFiles(base);
  const discovered = scan.files;
  diagnostics.push(...scan.diagnostics);
  const recovered = new Map<string, string>();

  for (const item of discovered) {
    if (previous[item.file]) continue;
    const verified = verifiedManagedFingerprint(item.content);
    const legacy = verified ?? knownLegacyPointerFingerprint(item.file, item.content);
    if (legacy) recovered.set(item.file, legacy);
  }
  for (const [file, hash] of recovered) manifest[file] = hash;

  const currentFiles = new Set(Object.keys(documents));
  const migratedLegacy = new Set<string>();
  const migrationNotes = new Map<string, Array<{ source: string; notes: string }>>();
  for (const [file, hash] of Object.entries(manifest)) {
    if (currentFiles.has(file)) continue;
    const target = legacyGuideDestination(config.output, file);
    if (!target || !Object.hasOwn(documents, target) || skip.has(target)) continue;
    if (await isWithinNestedProject(base, file)) continue;
    const original = await readOptional(await assertSafePath(base, file));
    if (original === undefined) continue;
    const removal = removeManagedContent(original, hash);
    if (!removal?.content?.trim()) continue;
    const notes = migrationNotes.get(target) ?? [];
    notes.push({ source: file, notes: removal.content });
    migrationNotes.set(target, notes);
  }

  for (const [file, document] of Object.entries(documents)) {
    const destination = await assertSafePath(base, file);
    const original = await readOptional(destination);
    const expectedHash = previous[file] ?? recovered.get(file);
    const notes = migrationNotes.get(file) ?? [];
    const withNotes = (body: string): Document =>
      notes.reduce(
        (current, item) =>
          appendMigratedNotes(current, item.notes, item.source, config.docsLanguage),
        { ...document, body },
      );
    let replacement: ReturnType<typeof replaceManagedContent>;
    let usedThreeWayMerge = false;
    if (original !== undefined && isCanonicalGuide(config.output, file)) {
      const baseline = previousBaselines[file];
      const payload = managedPayload(original);
      const nextBody = generatedBodies.get(file) ?? document.body;
      if (baseline !== undefined && payload !== undefined && payload !== baseline) {
        const merge = mergeTextThreeWayDetailed(baseline, payload, nextBody);
        if (merge.kind === 'merged') {
          replacement = replaceManagedContent(original, withNotes(merge.text), expectedHash, {
            force: true,
          });
          usedThreeWayMerge = true;
        } else if (merge.kind === 'limit') {
          if (actionFor(file, original) === 'replace') {
            replacement = replaceManagedContent(original, withNotes(nextBody), expectedHash, {
              force: true,
            });
            if (replacement && replacement.content !== original) addBackup(backups, file, original);
          } else if (actionFor(file, original) === 'skip') {
            skipped.push(file);
            continue;
          } else {
            const proposed = replaceManagedContent(
              undefined,
              withNotes(nextBody),
              undefined,
            )?.content;
            addConflict(
              conflictDetails,
              file,
              'The guide is too large for a safe automatic comparison; choose to skip it or back up and replace it.',
              'limit',
              original,
              proposed,
              { reasonCode: 'work-limit' },
            );
            continue;
          }
        } else {
          const resolution = decisions.hunks?.[file];
          const snapshotMatches =
            resolution?.baseFingerprint === fingerprint(baseline) &&
            resolution.localFingerprint === fingerprint(payload) &&
            resolution.generatedFingerprint === fingerprint(nextBody) &&
            merge.hunks.every((hunk) => Object.hasOwn(resolution.choices, hunk.id));
          if (snapshotMatches) {
            const merged = resolveThreeWayMerge(merge, resolution.choices);
            if (merged === undefined) throw new Error(`Incomplete merge decisions for ${file}.`);
            replacement = replaceManagedContent(original, withNotes(merged), expectedHash, {
              force: true,
            });
            usedThreeWayMerge = true;
          } else if (actionFor(file, original) === 'replace') {
            replacement = replaceManagedContent(original, withNotes(nextBody), expectedHash, {
              force: true,
            });
            if (replacement && replacement.content !== original) addBackup(backups, file, original);
          } else if (actionFor(file, original) === 'skip') {
            skipped.push(file);
            continue;
          } else {
            const proposed = replaceManagedContent(original, withNotes(nextBody), expectedHash, {
              force: true,
            })?.content;
            addConflict(
              conflictDetails,
              file,
              'Developer edits overlap generated changes. Resolve each conflicting section or keep the file unchanged.',
              'merge',
              original,
              proposed,
              {
                reasonCode: 'overlap',
                merge: {
                  baseFingerprint: fingerprint(baseline),
                  localFingerprint: fingerprint(payload),
                  generatedFingerprint: fingerprint(nextBody),
                  hunks: merge.hunks,
                },
              },
            );
            continue;
          }
        }
      }
    }
    if (!replacement)
      replacement = replaceManagedContent(original, withNotes(document.body), expectedHash);
    if (!replacement && actionFor(file, original) === 'replace') {
      replacement = replaceManagedContent(original, withNotes(document.body), expectedHash, {
        force: true,
      });
      if (replacement && original !== undefined && replacement.content !== original)
        addBackup(backups, file, original);
    }
    if (!replacement) {
      if (actionFor(file, original) === 'skip') {
        skipped.push(file);
        continue;
      }
      const reason = original?.includes(BEGIN_MARKER)
        ? 'Managed ownership could not be verified; the content may have been edited or generated by an older version.'
        : 'The destination already contains unowned content.';
      const proposed =
        replaceManagedContent(undefined, withNotes(document.body), undefined)?.content ??
        document.body;
      addConflict(conflictDetails, file, reason, 'target', original, proposed, {
        reasonCode: original?.includes(BEGIN_MARKER) ? 'ownership' : 'unowned',
      });
      continue;
    }
    if (usedThreeWayMerge && original !== replacement.content) addBackup(backups, file, original!);
    manifest[file] = replacement.fingerprint;
    if (isCanonicalGuide(config.output, file))
      baselines[file] = generatedBodies.get(file) ?? document.body;
    if (original !== replacement.content)
      changes.push({ file, original, content: replacement.content });
    for (const item of notes) migratedLegacy.add(item.source);
  }

  for (const [file, hash] of Object.entries(manifest)) {
    if (currentFiles.has(file)) continue;
    if (await isWithinNestedProject(base, file)) {
      if (skip.has(file)) skipped.push(file);
      else
        addConflict(
          conflictDetails,
          file,
          'This path is inside a nested project; the parent generator will not remove or adopt it.',
          'stale',
        );
      continue;
    }
    const destination = await assertSafePath(base, file);
    const original = await readOptional(destination);
    if (original === undefined) {
      delete manifest[file];
      continue;
    }
    let removal = removeManagedContent(original, hash);
    if (migratedLegacy.has(file) && removal) {
      addBackup(backups, file, original);
      removal = { ...removal, content: undefined };
    }
    const baseline = previousBaselines[file];
    const payload = managedPayload(original);
    const customized =
      !removal ||
      (removal.content?.trim().length ?? 0) > 0 ||
      (baseline !== undefined && payload !== undefined && payload !== baseline);
    if (customized && !migratedLegacy.has(file)) {
      if (actionFor(file, original) === 'skip') {
        skipped.push(file);
        continue;
      }
      if (actionFor(file, original) === 'retain') {
        const content = retainedContent(
          original,
          file,
          retainedPath(config.output, file, original),
          base,
        );
        const archive = retainedPath(config.output, file, original);
        const archivePath = await assertSafePath(base, archive);
        const archivedOriginal = await readOptional(archivePath);
        if (archivedOriginal !== undefined && archivedOriginal !== content) {
          addConflict(
            conflictDetails,
            file,
            `The retained document already exists with different content: ${archive}`,
            'stale',
            original,
            content,
            { reasonCode: 'modified-removal', archivePath: archive },
          );
          continue;
        }
        if (archivedOriginal === undefined)
          changes.push({ file: archive, original: undefined, content });
        removals.push({ file, original, content: undefined });
      } else if (
        actionFor(file, original) === 'delete' ||
        actionFor(file, original) === 'replace'
      ) {
        addBackup(backups, file, original);
        removals.push({ file, original, content: undefined });
      } else {
        const archive = retainedPath(config.output, file, original);
        addConflict(
          conflictDetails,
          file,
          'This output contains developer edits and is no longer selected. Choose whether to retain it as a plain document or delete it after creating a backup.',
          'stale',
          original,
          retainedContent(original, file, archive, base),
          { reasonCode: 'modified-removal', archivePath: archive },
        );
        continue;
      }
      removed.push(file);
      delete manifest[file];
      delete baselines[file];
      continue;
    }
    const legacyTarget = legacyGuideDestination(config.output, file);
    if (
      removal?.content?.trim() &&
      legacyTarget &&
      (!Object.hasOwn(documents, legacyTarget) || skip.has(legacyTarget)) &&
      !migratedLegacy.has(file)
    ) {
      if (actionFor(file, original) === 'replace' || actionFor(file, original) === 'delete') {
        addBackup(backups, file, original);
        removal = { ...removal, content: undefined };
      } else if (actionFor(file, original) === 'skip') skipped.push(file);
      else
        addConflict(
          conflictDetails,
          file,
          `This file contains developer notes but its destination guide is not selected: ${legacyTarget}`,
          'stale',
          original,
        );
      continue;
    }
    if (
      !removal &&
      (actionFor(file, original) === 'replace' || actionFor(file, original) === 'delete')
    ) {
      removal = removeManagedContent(original, hash, { force: true });
      addBackup(backups, file, original);
      if (!removal) removal = { content: undefined, fingerprint: hash };
    }
    if (!removal) {
      if (actionFor(file, original) === 'skip') {
        skipped.push(file);
        continue;
      }
      addConflict(
        conflictDetails,
        file,
        'This generated output is no longer selected, but its content has changed since generation. Choose whether to retain it as a plain document or delete it after creating a backup.',
        'stale',
        original,
        undefined,
        {
          reasonCode: 'modified-removal',
          archivePath: retainedPath(config.output, file, original),
        },
      );
      continue;
    }
    if (removal.content === undefined) {
      removals.push({ file, original, content: undefined });
      removed.push(file);
    } else if (removal.content !== original) {
      changes.push({ file, original, content: removal.content });
    }
    delete manifest[file];
    delete baselines[file];
  }

  for (const item of discovered) {
    if (
      currentFiles.has(item.file) ||
      previous[item.file] ||
      manifest[item.file] ||
      recovered.has(item.file)
    )
      continue;
    if (actionFor(item.file, item.content) === 'skip') {
      skipped.push(item.file);
      continue;
    }
    if (actionFor(item.file, item.content) === 'replace') {
      addBackup(backups, item.file, item.content);
      const pruned = removeManagedContent(item.content, '', { force: true });
      if (pruned?.content === undefined) {
        removals.push({ file: item.file, original: item.content, content: undefined });
      } else if (pruned) {
        changes.push({ file: item.file, original: item.content, content: pruned.content });
      } else {
        removals.push({ file: item.file, original: item.content, content: undefined });
      }
      removed.push(item.file);
      continue;
    }
    addConflict(
      conflictDetails,
      item.file,
      'A managed marker was found without a verifiable ownership record.',
      'orphan',
      item.content,
      undefined,
      { reasonCode: 'ownership' },
    );
  }

  const metadata: FileChange[] = [];
  for (const [file, value] of [
    [CONFIG_PATH, config],
    [MANIFEST_PATH, manifest],
    [BASELINE_PATH, baselines],
  ] as const) {
    const original = await readOptional(await assertSafePath(base, file));
    const content = JSON.stringify(value, null, 2) + '\n';
    if (original !== content) metadata.push({ file, original, content });
  }
  return {
    root: base,
    files: Object.keys(documents),
    changes,
    removals,
    backups,
    metadata,
    conflicts: conflictDetails.map(({ file }) => file),
    conflictDetails,
    removed,
    skipped,
    recovered: [...recovered.keys()],
    diagnostics,
  };
}

function resultForPlan(plan: GenerationPlan, status: GenerationStatus): GenerationResult {
  const completed = status === 'applied' || status === 'partial';
  return {
    changes: plan.changes.map(({ file }) => file),
    conflicts: plan.conflicts,
    conflictDetails: plan.conflictDetails,
    recovered: plan.recovered,
    status,
    planned: {
      writes: plan.changes.map(({ file }) => file),
      removals: plan.removals.map(({ file }) => file),
      backups: plan.backups.map(({ file }) => file),
      metadata: plan.metadata.map(({ file }) => file),
    },
    written: completed
      ? [
          ...plan.backups.map(({ file }) => file),
          ...plan.changes.map(({ file }) => file),
          ...plan.metadata.map(({ file }) => file),
        ]
      : [],
    removed: completed ? plan.removals.map(({ file }) => file) : [],
    skipped: plan.skipped,
    backups: completed ? plan.backups.map(({ file }) => file) : [],
    diagnostics: plan.diagnostics,
  };
}

export async function commitGeneration(plan: GenerationPlan): Promise<GenerationResult> {
  if (plan.conflicts.length) return resultForPlan(plan, 'blocked');
  const operations = [...plan.backups, ...plan.changes, ...plan.removals, ...plan.metadata];
  await applyChanges(plan.root, operations, async (file) => {
    if (await isWithinNestedProject(plan.root, file)) {
      throw new Error(
        `Refusing to write ${file} inside a nested project. Run the CLI from that child project root.`,
      );
    }
  });
  return resultForPlan(plan, plan.skipped.length ? 'partial' : 'applied');
}

export function previewGeneration(plan: GenerationPlan): GenerationResult {
  return resultForPlan(plan, plan.conflicts.length ? 'blocked' : 'preview');
}

export async function generate(
  root: string,
  config: Config,
  dryRun = false,
): Promise<GenerationResult> {
  const plan = await planGeneration(root, config);
  if (dryRun) return previewGeneration(plan);
  return commitGeneration(plan);
}
