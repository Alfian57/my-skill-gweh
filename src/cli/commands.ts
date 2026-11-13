import path from 'node:path';
import { agents, catalog } from '../catalog.js';
import { CONFIG_PATH, defaults, loadConfig } from '../config.js';
import { detect } from '../detection.js';
import { doctor, isHealthy } from '../doctor.js';
import { assertSafePath, projectRoot, readOptional } from '../filesystem.js';
import { commitGeneration, planGeneration } from '../generator.js';
import { listPresets, presetDirectory, removePreset, savePreset, showPreset } from '../presets.js';
import type { Command, ProjectOptions } from './options.js';
import { HELP } from './options.js';
import { report, type Write } from './output.js';
import { configure, confirmWrite, type Prompts } from './wizard.js';

export interface Context {
  cwd: string;
  version: string;
  interactive: boolean;
  write: Write;
  presets: string;
  prompts?: Prompts;
}

export function defaultContext(version: string): Context {
  return {
    cwd: process.cwd(),
    version,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    write: (text) => console.log(text),
    presets: presetDirectory(),
  };
}

async function runProject(options: ProjectOptions, context: Context): Promise<number> {
  const root = await projectRoot(path.resolve(context.cwd, options.target));
  const configFile = await assertSafePath(root, CONFIG_PATH);
  if (options.command === 'init' && (await readOptional(configFile)) !== undefined) {
    throw new Error('Already initialized; use update.');
  }
  if (options.command === 'init' && options.nonInteractive && !options.config) {
    throw new Error('--config is required for non-interactive init.');
  }
  if (!options.nonInteractive && options.command !== 'doctor' && !context.interactive) {
    throw new Error(
      'No interactive terminal. Use --non-interactive with an explicit configuration.',
    );
  }

  // update must start from an initialized project even when --config is supplied.
  let config = options.command === 'init' ? defaults() : await loadConfig(configFile);
  if (options.config) config = await loadConfig(path.resolve(context.cwd, options.config));
  if (options.command === 'doctor') {
    const result = await doctor(root, config);
    report(result, options.json, context.write);
    return isHealthy(result) ? 0 : 1;
  }

  if (!options.nonInteractive && (options.command === 'init' || options.reconfigure)) {
    const detection = await detect(root);
    if (!config.stack.length) config.stack = detection.stack;
    config = await configure(config, detection, context.prompts);
  }
  const plan = await planGeneration(root, config);
  const preview = { changes: plan.changes.map(({ file }) => file), conflicts: plan.conflicts };
  if (options.dryRun || plan.conflicts.length) {
    report(preview, options.json, context.write);
    return plan.conflicts.length ? 1 : 0;
  }
  if (!options.nonInteractive) {
    report(preview, false, context.write);
    if (!(await confirmWrite(config.language, context.prompts))) return 0;
  }
  report(await commitGeneration(plan), options.json, context.write);
  return 0;
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
