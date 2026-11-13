import { CONFIG_PATH, MANIFEST_PATH, parseConfig, type Config } from './config.js';
import { assertSafePath, projectRoot, readOptional, safe } from './filesystem.js';
import { isRecord } from './errors.js';
import { renderDocuments } from './render.js';
import { collectProjectContext } from './project-context.js';
import { detect } from './detection.js';
import { replaceManagedContent } from './managed-content.js';
import { applyChanges, LOCK_PATH, type FileChange } from './transaction.js';

export interface GenerationResult {
  changes: string[];
  conflicts: string[];
}

export interface GenerationPlan {
  root: string;
  files: string[];
  changes: FileChange[];
  metadata: FileChange[];
  conflicts: string[];
}

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

export async function planGeneration(root: string, input: Config): Promise<GenerationPlan> {
  const config = parseConfig(input);
  const base = await projectRoot(root);
  if (config.output.split('/')[0] === LOCK_PATH)
    throw new Error('Output conflicts with the generation lock.');
  const detection = await detect(base);
  const context = await collectProjectContext(base, config, detection);
  const documents = renderDocuments(base, config, detection, context);
  const previous = await loadManifest(base);
  const manifest = { ...previous };
  const changes: FileChange[] = [];
  const conflicts: string[] = [];

  for (const [file, document] of Object.entries(documents)) {
    const destination = await assertSafePath(base, file);
    const original = await readOptional(destination);
    const replacement = replaceManagedContent(original, document, previous[file]);
    if (!replacement) {
      conflicts.push(file);
      continue;
    }
    manifest[file] = replacement.fingerprint;
    if (original !== replacement.content)
      changes.push({ file, original, content: replacement.content });
  }

  const metadata: FileChange[] = [];
  for (const [file, value] of [
    [CONFIG_PATH, config],
    [MANIFEST_PATH, manifest],
  ] as const) {
    const original = await readOptional(await assertSafePath(base, file));
    const content = JSON.stringify(value, null, 2) + '\n';
    if (original !== content) metadata.push({ file, original, content });
  }
  return { root: base, files: Object.keys(documents), changes, metadata, conflicts };
}

export async function commitGeneration(plan: GenerationPlan): Promise<GenerationResult> {
  const result = { changes: plan.changes.map(({ file }) => file), conflicts: plan.conflicts };
  if (!plan.conflicts.length) await applyChanges(plan.root, [...plan.changes, ...plan.metadata]);
  return result;
}

export async function generate(
  root: string,
  config: Config,
  dryRun = false,
): Promise<GenerationResult> {
  const plan = await planGeneration(root, config);
  if (dryRun) return { changes: plan.changes.map(({ file }) => file), conflicts: plan.conflicts };
  return commitGeneration(plan);
}
