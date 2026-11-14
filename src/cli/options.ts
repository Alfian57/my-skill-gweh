import { parseArgs } from 'node:util';

export interface ProjectOptions {
  kind: 'project';
  command: 'init' | 'update' | 'doctor';
  target: string;
  config?: string;
  nonInteractive: boolean;
  reconfigure: boolean;
  dryRun: boolean;
  json: boolean;
}

export type Command =
  | ProjectOptions
  | { kind: 'list'; json: boolean }
  | {
      kind: 'skill';
      action: 'enable' | 'disable';
      skill: string;
      target: string;
      dryRun: boolean;
      json: boolean;
    }
  | {
      kind: 'preset';
      action: 'save' | 'list' | 'show' | 'remove';
      name?: string;
      config?: string;
      json: boolean;
    }
  | { kind: 'help' }
  | { kind: 'version'; verbose: boolean };

export const HELP = `my-skill-gweh init|update|doctor [path]
my-skill-gweh list [--json]
my-skill-gweh skill enable|disable <id> [path]
my-skill-gweh preset save|list|show|remove [name]

--config file       Configuration input for init, update or preset save
--non-interactive   Use explicit configuration without prompting
--dry-run           Preview init/update/skill changes without writing files
--reconfigure       Reopen the wizard for update
--json              Emit machine-readable output
-h, --help          Show this help
-v, --version       Show the package version; --verbose shows install details`;

export function parseCommand(args: string[]): Command {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean' },
      config: { type: 'string' },
      'non-interactive': { type: 'boolean' },
      reconfigure: { type: 'boolean' },
      json: { type: 'boolean' },
      verbose: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version', verbose: values.verbose ?? false };
  if (values.verbose) throw new Error('--verbose requires --version.');
  const [command = 'init', target, ...extra] = positionals;
  const json = values.json ?? false;

  if (command === 'list' || command === 'preset') {
    if (values['dry-run'] || values.reconfigure || values['non-interactive']) {
      throw new Error('Project flags are only supported by init/update.');
    }
    if (command === 'list') {
      if (target || values.config) throw new Error('Usage: my-skill-gweh list [--json]');
      return { kind: 'list', json };
    }
    const action = target;
    if (action !== 'save' && action !== 'list' && action !== 'show' && action !== 'remove') {
      throw new Error('Preset action must be save, list, show or remove.');
    }
    if (extra.length > 1 || (action === 'list' ? extra.length !== 0 : !extra[0])) {
      throw new Error(`Usage: my-skill-gweh preset ${action}${action === 'list' ? '' : ' NAME'}`);
    }
    if (values.config && action !== 'save')
      throw new Error('--config is only supported by preset save.');
    return {
      kind: 'preset',
      action,
      json,
      ...(extra[0] ? { name: extra[0] } : {}),
      ...(values.config ? { config: values.config } : {}),
    };
  }

  if (command === 'skill') {
    const action = target;
    if (action !== 'enable' && action !== 'disable') {
      throw new Error('Skill action must be enable or disable.');
    }
    if (extra.length < 1 || extra.length > 2) {
      throw new Error(`Usage: my-skill-gweh skill ${action} ID [path]`);
    }
    if (values.config || values.reconfigure || values['non-interactive']) {
      throw new Error(
        'Skill commands do not support --config, --reconfigure or --non-interactive.',
      );
    }
    if (json && !values['dry-run'])
      throw new Error('--json for skill commands requires --dry-run.');
    return {
      kind: 'skill',
      action,
      skill: extra[0]!,
      target: extra[1] ?? '.',
      dryRun: values['dry-run'] ?? false,
      json,
    };
  }

  if (command !== 'init' && command !== 'update' && command !== 'doctor') {
    throw new Error(`Unknown command: ${command}`);
  }
  if (extra.length) throw new Error(`Usage: my-skill-gweh ${command} [path]`);
  if (
    command === 'doctor' &&
    (values.config || values['dry-run'] || values.reconfigure || values['non-interactive'])
  ) {
    throw new Error('doctor supports only a project path and --json.');
  }
  if (values.reconfigure && command !== 'update') throw new Error('--reconfigure requires update.');
  if (values.reconfigure && values['non-interactive'])
    throw new Error('--reconfigure cannot be non-interactive.');
  if (json && command !== 'doctor' && !values['non-interactive']) {
    throw new Error('--json requires --non-interactive for init/update.');
  }
  return {
    kind: 'project',
    command,
    target: target ?? '.',
    json,
    nonInteractive: values['non-interactive'] ?? false,
    reconfigure: values.reconfigure ?? false,
    dryRun: values['dry-run'] ?? false,
    ...(values.config ? { config: values.config } : {}),
  };
}
