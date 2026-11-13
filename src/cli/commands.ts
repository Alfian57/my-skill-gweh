import path from 'node:path';
import * as prompts from '@clack/prompts';
import { agents, catalog } from '../catalog.js';
import { CONFIG_PATH, defaults, loadConfig } from '../config.js';
import { detect } from '../detection.js';
import { doctor, isHealthy } from '../doctor.js';
import { assertSafePath, projectRoot, readOptional } from '../filesystem.js';
import { commitGeneration, planGeneration, previewGeneration } from '../generator.js';
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
    presets: presetDirectory(),
    spinner: prompts.spinner,
  };
}

async function withProgress<T>(
  context: Context,
  message: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!context.interactive || !context.spinner) return action();
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
    if (visible) spinner.stop();
  }
}

function conflictReason(reason: string, language: 'id' | 'en'): string {
  if (language === 'en') return reason;
  if (reason.includes('nested project'))
    return 'Path ini berada di dalam nested project; generator parent tidak akan menghapus atau mengambil alih file tersebut.';
  if (reason.includes('developer notes'))
    return `File berisi catatan developer, tetapi skill tujuan tidak dipilih: ${reason.split(': ').at(-1) ?? ''}`;
  if (reason.startsWith('Managed ownership could not be verified'))
    return 'Kepemilikan file terkelola tidak dapat diverifikasi; konten mungkin diedit atau dibuat oleh versi lama.';
  if (reason.startsWith('The destination already contains unowned content'))
    return 'Tujuan sudah berisi konten yang tidak dikelola generator.';
  if (reason.startsWith('This generated output is no longer selected'))
    return 'Output ini tidak lagi dipilih, tetapi kontennya berubah sejak dibuat.';
  if (reason.startsWith('A managed marker was found'))
    return 'Marker generator ditemukan tanpa catatan kepemilikan yang dapat diverifikasi.';
  return reason;
}

async function runProject(options: ProjectOptions, context: Context): Promise<number> {
  const root = await projectRoot(path.resolve(context.cwd, options.target));
  if (options.command === 'doctor') {
    const result = await doctor(root);
    report(result, options.json, context.write);
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

  let wizardDetection: Awaited<ReturnType<typeof detect>> | undefined;
  if (!options.nonInteractive && (options.command === 'init' || options.reconfigure)) {
    const detection = await withProgress(
      context,
      config.language === 'en' ? 'Scanning project' : 'Memindai project',
      () => detect(root),
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
          context.write(`${conflict.file}: ${conflictReason(conflict.reason, config.language)}`);
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
        context.write(`${conflict.file}: ${conflictReason(conflict.reason, config.language)}`);
        if (conflict.merge) {
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
            hunks[conflict.file] ??= {
              baseFingerprint: conflict.merge.baseFingerprint,
              localFingerprint: conflict.merge.localFingerprint,
              generatedFingerprint: conflict.merge.generatedFingerprint,
              choices: {},
            };
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
    report(preview, options.json, context.write, config.language);
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
    report(preview, false, context.write, config.language);
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
  );
  report(result, options.json, context.write, config.language);
  return result.status === 'partial' ? 1 : 0;
}

export async function runCommand(command: Command, context: Context): Promise<number> {
  switch (command.kind) {
    case 'help':
      context.write(HELP);
      return 0;
    case 'version':
      context.write(context.version);
      return 0;
    case 'list':
      report({ agents, skills: catalog }, command.json, context.write);
      return 0;
    case 'project':
      return runProject(command, context);
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
