import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prompts from '@clack/prompts';
import {
  agents,
  catalog,
  skillIds,
  skillsIntroducedAfter,
  SKILL_CATALOG_REVISION,
} from '../catalog.js';
import { CONFIG_PATH, defaults, loadConfig, type Config } from '../config.js';
import { detect } from '../detection.js';
import { doctor, isHealthy } from '../doctor.js';
import { assertSafePath, projectRoot, readOptional } from '../filesystem.js';
import {
  commitGeneration,
  planGeneration,
  previewGeneration,
  type GenerationConflict,
} from '../generator.js';
import { fingerprint } from '../managed-content.js';
import { listPresets, presetDirectory, removePreset, savePreset, showPreset } from '../presets.js';
import { unifiedDiff } from './diff.js';
import type { Command, ProjectOptions } from './options.js';
import { HELP } from './options.js';
import { report, type Write } from './output.js';
import {
  configure,
  confirmWrite,
  recommendedSkills,
  resolveConflict,
  resolveMergeHunk,
  type Prompts,
} from './wizard.js';

export interface Context {
  cwd: string;
  version: string;
  interactive: boolean;
  write: Write;
  warn?: Write;
  presets: string;
  prompts?: Prompts;
  spinner?: () => { start(message: string): void; stop(message?: string): void };
}

export function defaultContext(version: string): Context {
  return {
    cwd: process.cwd(),
    version,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    write: (text) => console.log(text),
    warn: (text) => console.error(text),
    presets: presetDirectory(),
    spinner: prompts.spinner,
  };
}

async function withProgress<T>(
  context: Context,
  message: string,
  action: () => Promise<T>,
  completed: string,
  quiet = false,
): Promise<T> {
  if (quiet || !context.interactive || !context.spinner) return action();
  const spinner = context.spinner();
  let visible = false;
  const timer = setTimeout(() => {
    visible = true;
    spinner.start(message);
  }, 120);
  try {
    return await action();
  } finally {
    clearTimeout(timer);
    if (visible) spinner.stop(completed);
  }
}

function conflictReason(conflict: GenerationConflict, language: 'id' | 'en'): string {
  const messages: Record<GenerationConflict['reasonCode'], [string, string]> = {
    unowned: [
      'The destination already contains content not managed by the generator.',
      'Tujuan sudah berisi konten yang tidak dikelola generator.',
    ],
    ownership: [
      'Managed ownership could not be verified; inspect the existing content.',
      'Kepemilikan file terkelola tidak dapat diverifikasi; periksa konten yang ada.',
    ],
    overlap: [
      'Developer edits overlap generated changes; resolve the sections individually.',
      'Edit developer bertumpuk dengan perubahan generator; selesaikan tiap bagian.',
    ],
    'work-limit': [
      'The file is too large for a safe automatic comparison.',
      'File terlalu besar untuk dibandingkan secara otomatis dengan aman.',
    ],
    'modified-removal': [
      'This customized output is no longer selected; choose retain or delete after backup.',
      'Output yang diedit tidak lagi dipilih; pilih simpan atau hapus setelah backup.',
    ],
    'nested-project': [
      'Run the CLI from the nested child project root.',
      'Jalankan CLI dari root child project tersebut.',
    ],
    'developer-notes': [
      'This file contains developer notes, but its destination guide is not selected.',
      'File ini berisi catatan developer, tetapi panduan tujuannya tidak dipilih.',
    ],
  };
  return messages[conflict.reasonCode][language === 'en' ? 0 : 1];
}

function notifyUnreviewedSkills(config: Config, options: ProjectOptions, context: Context): void {
  if (options.command !== 'update' || options.reconfigure || options.config) return;
  const revision = config.skillCatalogRevision ?? 0;
  const unseen = skillsIntroducedAfter(revision).filter((skill) => !config.skills.includes(skill));
  if (!unseen.length) return;
  const labels = unseen.map(
    (skill) => `${skill} (${catalog[skill]?.[config.language === 'en' ? 0 : 1] ?? skill})`,
  );
  const firstUnseen = unseen[0]!;
  const text =
    config.language === 'en'
      ? `New optional skill${unseen.length === 1 ? '' : 's'} available: ${labels.join(', ')}. Enable with \`my-skill-gweh skill enable ${firstUnseen}\` or review all choices with \`my-skill-gweh update --reconfigure\`.`
      : `Skill opsional baru tersedia: ${labels.join(', ')}. Aktifkan dengan \`my-skill-gweh skill enable ${firstUnseen}\` atau tinjau semua pilihan dengan \`my-skill-gweh update --reconfigure\`.`;
  if (options.json) context.warn?.(text);
  else context.write(text);
}

async function runProject(
  options: ProjectOptions,
  context: Context,
  configOverride?: Config,
): Promise<number> {
  const root = await projectRoot(path.resolve(context.cwd, options.target));
  if (options.command === 'doctor') {
    let language: 'id' | 'en' = 'id';
    try {
      language = (await loadConfig(await assertSafePath(root, CONFIG_PATH))).language;
    } catch {
      // Doctor reports invalid configuration itself; keep its output readable in Indonesian.
    }
    const result = await doctor(root);
    report(result, options.json, context.write, language);
    return isHealthy(result) ? 0 : 1;
  }

  const configFile = await assertSafePath(root, CONFIG_PATH);
  if (options.command === 'init' && (await readOptional(configFile)) !== undefined) {
    throw new Error('Already initialized; use update.');
  }
  if (options.command === 'init' && options.nonInteractive && !options.config) {
    throw new Error('--config is required for non-interactive init.');
  }
  if (!options.nonInteractive && !context.interactive) {
    throw new Error(
      'No interactive terminal. Use --non-interactive with an explicit configuration.',
    );
  }

  // update must start from an initialized project even when --config is supplied.
  let config = options.command === 'init' ? defaults() : await loadConfig(configFile);
  if (options.config) config = await loadConfig(path.resolve(context.cwd, options.config));
  if (configOverride) config = configOverride;
  if (options.command === 'init' || options.config)
    config.skillCatalogRevision = SKILL_CATALOG_REVISION;
  notifyUnreviewedSkills(config, options, context);

  let wizardDetection: Awaited<ReturnType<typeof detect>> | undefined;
  if (!options.nonInteractive && (options.command === 'init' || options.reconfigure)) {
    const detection = await withProgress(
      context,
      config.language === 'en' ? 'Scanning project' : 'Memindai project',
      () => detect(root),
      config.language === 'en' ? 'Done' : 'Selesai',
      options.json,
    );
    wizardDetection = detection;
    const freshInteractiveInit = options.command === 'init' && !options.config;
    if (freshInteractiveInit && !config.stack.length) config.stack = detection.stack;
    const savedSkills = [...config.skills].sort().join('\0');
    const sameSkills = [
      [...recommendedSkills(config.stack, detection.uiEvidence)].sort().join('\0'),
      ['quality', 'docs', 'contracts', 'testing'].sort().join('\0'),
    ].includes(savedSkills);
    config = await configure(config, detection, context.prompts, {
      recommendSkills: freshInteractiveInit || (options.reconfigure && sameSkills),
      includeDetectedStack: freshInteractiveInit,
      presetDirectory: context.presets,
    });
  }
  let plan = await withProgress(
    context,
    config.language === 'en' ? 'Preparing generated files' : 'Menyiapkan file hasil generate',
    () => planGeneration(root, config, {}, wizardDetection),
    config.language === 'en' ? 'Done' : 'Selesai',
    options.json,
  );
  if (plan.recovered.length) {
    if (!options.json)
      context.write(
        config.language === 'en'
          ? `Recovered ${plan.recovered.length} managed file(s).`
          : `Memulihkan ${plan.recovered.length} file terkelola.`,
      );
  }
  const finalPreview = new Map<string, string>();
  if (plan.conflicts.length && !options.dryRun && !options.nonInteractive) {
    const resolutions: NonNullable<Parameters<typeof planGeneration>[2]>['resolutions'] = {};
    const hunks: NonNullable<Parameters<typeof planGeneration>[2]>['hunks'] = {};
    let rounds = 0;
    while (plan.conflicts.length && rounds < 5) {
      if (plan.conflictDetails.some(({ kind }) => kind === 'nested')) {
        for (const conflict of plan.conflictDetails)
          context.write(`${conflict.file}: ${conflictReason(conflict, config.language)}`);
        report(previewGeneration(plan), options.json, context.write, config.language);
        return 1;
      }
      const signature = JSON.stringify(
        plan.conflictDetails.map(({ file, kind, reason, existing, proposed, merge }) => ({
          file,
          kind,
          reason,
          existing: existing === undefined ? 'missing' : fingerprint(existing),
          proposed: proposed === undefined ? 'missing' : fingerprint(proposed),
          base: merge?.baseFingerprint,
          local: merge?.localFingerprint,
          generated: merge?.generatedFingerprint,
        })),
      );
      for (const conflict of plan.conflictDetails) {
        context.write(`${conflict.file}: ${conflictReason(conflict, config.language)}`);
        if (conflict.merge) {
          const saved = hunks[conflict.file];
          if (
            !saved ||
            saved.baseFingerprint !== conflict.merge.baseFingerprint ||
            saved.localFingerprint !== conflict.merge.localFingerprint ||
            saved.generatedFingerprint !== conflict.merge.generatedFingerprint
          ) {
            hunks[conflict.file] = {
              baseFingerprint: conflict.merge.baseFingerprint,
              localFingerprint: conflict.merge.localFingerprint,
              generatedFingerprint: conflict.merge.generatedFingerprint,
              choices: {},
            };
          }
          for (const [index, hunk] of conflict.merge.hunks.entries()) {
            context.write(
              config.language === 'en'
                ? `Conflict ${index + 1}/${conflict.merge.hunks.length}, around line ${hunk.startLine}`
                : `Konflik ${index + 1}/${conflict.merge.hunks.length}, sekitar baris ${hunk.startLine}`,
            );
            if (hunk.contextBefore)
              context.write(`  ${hunk.contextBefore.replaceAll('\n', '\n  ')}`);
            context.write(unifiedDiff(hunk.local, hunk.generated));
            if (hunk.contextAfter) context.write(`  ${hunk.contextAfter.replaceAll('\n', '\n  ')}`);
            const choice = await resolveMergeHunk(
              hunk,
              index,
              conflict.merge.hunks.length,
              config.language,
              context.prompts,
            );
            if (choice === 'cancel') {
              const cancelled = previewGeneration(plan);
              cancelled.status = 'cancelled';
              report(cancelled, options.json, context.write, config.language);
              return 0;
            }
            if (choice === 'skip') {
              resolutions[conflict.file] = {
                action: 'skip',
                snapshot:
                  conflict.existing === undefined ? 'missing' : fingerprint(conflict.existing),
              };
              break;
            }
            finalPreview.set(conflict.file, conflict.file);
            hunks[conflict.file]!.choices[hunk.id] = choice;
          }
          continue;
        }
        context.write(unifiedDiff(conflict.existing, conflict.proposed));
        const mode =
          conflict.reasonCode === 'modified-removal'
            ? 'stale'
            : conflict.kind === 'limit'
              ? 'limit'
              : conflict.kind === 'orphan'
                ? 'orphan'
                : 'target';
        const decision = await resolveConflict(
          conflict.file,
          config.language,
          context.prompts,
          mode,
        );
        if (decision === 'cancel') {
          const cancelled = previewGeneration(plan);
          cancelled.status = 'cancelled';
          report(cancelled, options.json, context.write, config.language);
          return 0;
        }
        resolutions[conflict.file] = {
          action: decision,
          snapshot: conflict.existing === undefined ? 'missing' : fingerprint(conflict.existing),
        };
        if (decision !== 'skip')
          finalPreview.set(
            conflict.file,
            decision === 'retain' ? (conflict.archivePath ?? conflict.file) : conflict.file,
          );
      }
      plan = await withProgress(
        context,
        config.language === 'en' ? 'Refreshing the plan' : 'Memperbarui rencana',
        () => planGeneration(root, config, { resolutions, hunks }),
        config.language === 'en' ? 'Done' : 'Selesai',
        options.json,
      );
      rounds += 1;
      const nextSignature = JSON.stringify(
        plan.conflictDetails.map(({ file, kind, reason, existing, proposed, merge }) => ({
          file,
          kind,
          reason,
          existing: existing === undefined ? 'missing' : fingerprint(existing),
          proposed: proposed === undefined ? 'missing' : fingerprint(proposed),
          base: merge?.baseFingerprint,
          local: merge?.localFingerprint,
          generated: merge?.generatedFingerprint,
        })),
      );
      if (plan.conflicts.length && nextSignature === signature) break;
    }
  }
  const preview = previewGeneration(plan);
  if (options.dryRun || plan.conflicts.length) {
    report(preview, options.json, context.write, config.language, {
      ...(options.dryRun ? { previewKind: 'dry-run' as const } : {}),
    });
    return plan.conflicts.length ? 1 : 0;
  }
  if (!options.nonInteractive) {
    const hasOperations =
      plan.changes.length + plan.removals.length + plan.backups.length + plan.metadata.length > 0;
    if (!hasOperations) {
      const result = await commitGeneration(plan);
      report(result, options.json, context.write, config.language);
      return 0;
    }
    report(preview, false, context.write, config.language, { previewKind: 'confirmation' });
    for (const destination of new Set(finalPreview.values())) {
      const change = plan.changes.find((item) => item.file === destination);
      const removal = plan.removals.find((item) => item.file === destination);
      if (!change && !removal) continue;
      context.write(
        config.language === 'en'
          ? `Final content preview: ${destination}`
          : `Pratinjau isi akhir: ${destination}`,
      );
      context.write(unifiedDiff(change?.original ?? removal?.original, change?.content));
    }
    if (!(await confirmWrite(config.language, context.prompts))) {
      preview.status = 'cancelled';
      report(preview, options.json, context.write, config.language);
      return 0;
    }
  }
  const result = await withProgress(
    context,
    config.language === 'en' ? 'Writing project guidance' : 'Menulis panduan project',
    () => commitGeneration(plan),
    config.language === 'en' ? 'Done' : 'Selesai',
    options.json,
  );
  report(result, options.json, context.write, config.language);
  return result.status === 'partial' ? 1 : 0;
}

async function runSkillCommand(
  command: Extract<Command, { kind: 'skill' }>,
  context: Context,
): Promise<number> {
  if (!(skillIds as readonly string[]).includes(command.skill)) {
    throw new Error(
      `Unknown skill: ${command.skill}. Run my-skill-gweh list to see available skills.`,
    );
  }
  const root = await projectRoot(path.resolve(context.cwd, command.target));
  const configFile = await assertSafePath(root, CONFIG_PATH);
  const current = await loadConfig(configFile);
  const selected = new Set(current.skills);
  if (command.action === 'enable') selected.add(command.skill as Config['skills'][number]);
  else {
    if (selected.has(command.skill as Config['skills'][number]) && selected.size === 1) {
      throw new Error(
        'Cannot disable the only selected skill. Enable another skill first or use update --reconfigure.',
      );
    }
    selected.delete(command.skill as Config['skills'][number]);
  }
  const config: Config = {
    ...current,
    skills: skillIds.filter((skill) => selected.has(skill)),
    skillCatalogRevision: SKILL_CATALOG_REVISION,
  };
  return runProject(
    {
      kind: 'project',
      command: 'update',
      target: command.target,
      nonInteractive: command.dryRun,
      reconfigure: false,
      dryRun: command.dryRun,
      json: command.json,
    },
    context,
    config,
  );
}

export async function runCommand(command: Command, context: Context): Promise<number> {
  switch (command.kind) {
    case 'help':
      context.write(HELP);
      return 0;
    case 'version':
      context.write(
        command.verbose
          ? [
              context.version,
              `Install module: ${fileURLToPath(import.meta.url)}`,
              `Node: ${process.version}`,
            ].join(String.fromCharCode(10))
          : context.version,
      );
      return 0;
    case 'list':
      report({ agents, skills: catalog }, command.json, context.write);
      return 0;
    case 'project':
      return runProject(command, context);
    case 'skill':
      return runSkillCommand(command, context);
    case 'preset': {
      const directory = context.presets;
      if (command.action === 'list') {
        report(await listPresets(directory), command.json, context.write);
      } else {
        const name = command.name;
        if (!name) throw new Error('Preset name is required.');
        if (command.action === 'show') {
          report(await showPreset(directory, name), true, context.write);
        } else if (command.action === 'remove') {
          await removePreset(directory, name);
          report({ removed: name }, command.json, context.write);
        } else {
          const source = path.resolve(context.cwd, command.config ?? CONFIG_PATH);
          await savePreset(directory, name, source);
          report({ saved: name }, command.json, context.write);
        }
      }
      return 0;
    }
  }
}
