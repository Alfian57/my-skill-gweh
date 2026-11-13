import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaults, CONFIG_PATH } from '../dist/config.js';
import { parseCommand } from '../dist/cli/options.js';
import { runCommand } from '../dist/cli/commands.js';
import { CancelledError } from '../dist/errors.js';
import { configure, recommendedSkills } from '../dist/cli/wizard.js';
import { fixture, runCli, snapshot, writeJson } from './helpers.js';

for (const args of [
  ['unknown'],
  ['init', 'one', 'two'],
  ['preset', 'list', 'unexpected'],
  ['preset', 'remove'],
  ['list', '--config', 'ignored.json'],
  ['doctor', '--dry-run'],
  ['update', '--reconfigure', '--non-interactive'],
  ['init', '--json'],
  ['--unknown-flag'],
]) {
  test(`invalid CLI arguments fail clearly: ${args.join(' ')}`, async (t) => {
    const root = await fixture(t);
    const result = runCli(root, args);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.trim());
    assert.doesNotMatch(result.stderr, /at main|node:internal/);
    assert.deepEqual(await fs.readdir(root), []);
  });
}

test('init, update --config, doctor and dry-run work through the public executable', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'input.json', defaults());
  const args = ['init', '--config', 'input.json', '--non-interactive', '--json'];
  const before = await snapshot(root);
  const preview = runCli(root, [...args, '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.ok(JSON.parse(preview.stdout).changes.length > 0);
  assert.deepEqual(await snapshot(root), before);
  const init = runCli(root, args);
  assert.equal(init.status, 0, init.stderr);
  assert.deepEqual(JSON.parse(init.stdout).conflicts, []);
  assert.equal(runCli(root, ['doctor', '--json']).status, 0);

  await writeJson(root, 'input.json', { ...defaults(), docsLanguage: 'id' });
  const update = runCli(root, ['update', '--config', 'input.json', '--non-interactive', '--json']);
  assert.equal(update.status, 0, update.stderr);
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, CONFIG_PATH), 'utf8')).docsLanguage,
    'id',
  );
  const repeated = runCli(root, ['update', '--non-interactive', '--json']);
  assert.deepEqual(JSON.parse(repeated.stdout), {
    changes: [],
    conflicts: [],
    conflictDetails: [],
    recovered: [],
    status: 'applied',
    planned: { writes: [], removals: [], backups: [], metadata: [] },
    written: [],
    removed: [],
    skipped: [],
    backups: [],
    diagnostics: [],
  });
  assert.equal(
    runCli(root, args).status,
    1,
    'init --config must not bypass the existing-project guard',
  );
});

test('JSON update emits one JSON document when recovering managed files', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'input.json', { ...defaults(), agents: ['codex'], skills: ['quality'] });
  assert.equal(runCli(root, ['init', '--config', 'input.json', '--non-interactive']).status, 0);
  await fs.unlink(path.join(root, '.my-skill-gweh/manifest.json'));
  const result = runCli(root, ['update', '--non-interactive', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(report.recovered.length > 0);
  assert.equal(result.stdout.trimStart()[0], '{');
});

test('noninteractive init requires explicit configuration and validates it before detection', async (t) => {
  const root = await fixture(t);
  assert.equal(runCli(root, ['init', '--non-interactive']).status, 1);
  await writeJson(root, 'input.json', null);
  const invalid = runCli(root, ['init', '--non-interactive', '--config', 'input.json']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Configuration must be a JSON object/);
});

test('read-only commands and invalid preset actions create no global configuration', async (t) => {
  const root = await fixture(t);
  for (const args of [
    ['--help'],
    ['--version'],
    ['list', '--json'],
    ['preset', 'list'],
    ['preset', 'wrong'],
  ]) {
    runCli(root, args);
  }
  assert.deepEqual(await fs.readdir(root), []);
});

test('presets round-trip validated configuration and never overwrite an existing preset', async (t) => {
  const root = await fixture(t);
  await writeJson(root, CONFIG_PATH, defaults());
  assert.equal(runCli(root, ['preset', 'save', 'personal']).status, 0);
  assert.equal(runCli(root, ['preset', 'save', 'personal']).status, 1);
  const shown = runCli(root, ['preset', 'show', 'personal', '--json']);
  assert.deepEqual(JSON.parse(shown.stdout), defaults());
  assert.equal(runCli(root, ['preset', 'remove', 'personal']).status, 0);
});

test('wizard cancellation is an explicit result rather than process.exit inside library code', async () => {
  const io = { intro() {}, select: async () => Symbol('cancel') };
  await assert.rejects(
    configure(
      defaults(),
      { stack: [], evidence: [], commands: {}, ecosystems: [], sourceEvidence: [] },
      io,
    ),
    CancelledError,
  );
});

test('wizard can start from a saved preset and keep its choices editable', async (t) => {
  const presets = await fixture(t);
  const preset = { ...defaults(), agents: ['codex'], skills: ['quality'], stack: ['laravel'] };
  await writeJson(presets, 'personal.json', preset);
  const selects = ['personal', 'en', 'id', 'auto', 'feature-pr'];
  const io = {
    intro() {},
    note() {},
    select: async () => selects.shift(),
    text: async (options) => options.defaultValue,
    groupMultiselect: async (options) => options.initialValues,
    multiselect: async (options) => options.initialValues,
  };
  const configured = await configure(
    defaults(),
    { stack: [], evidence: [], commands: {}, ecosystems: [], sourceEvidence: [] },
    io,
    { presetDirectory: presets, recommendSkills: true, includeDetectedStack: true },
  );
  assert.deepEqual(configured.agents, ['codex']);
  assert.deepEqual(configured.skills, ['quality']);
  assert.deepEqual(configured.stack, ['php', 'laravel']);
  assert.equal(configured.validation, 'auto');
  assert.equal(configured.git, 'feature-pr');
});

test('wizard preserves existing choices and can configure Indonesian documentation', async () => {
  const initial = {
    ...defaults(),
    stack: ['go', 'custom-stack'],
    validation: 'auto',
    git: 'staging',
  };
  const selects = ['id', 'id', 'auto', 'staging'];
  const text = ['custom docs'];
  const notes = [];
  let stackOptions;
  const io = {
    intro() {},
    note(message) {
      notes.push(message);
    },
    select: async (options) => {
      if (options.message === 'Kebijakan pengujian') assert.equal(options.initialValue, 'auto');
      return selects.shift();
    },
    text: async () => text.shift(),
    multiselect: async (options) => options.initialValues,
    groupMultiselect: async (options) => {
      stackOptions = options;
      assert.deepEqual(options.initialValues, ['go', 'gin', 'custom-stack']);
      return options.initialValues;
    },
  };
  const configured = await configure(
    initial,
    {
      stack: ['gin'],
      evidence: ['go.mod'],
      commands: {},
      ecosystems: ['go-modules'],
      sourceEvidence: [],
    },
    io,
  );
  assert.deepEqual(configured.stack, ['go', 'gin', 'custom-stack']);
  assert.deepEqual(Object.keys(stackOptions.options), [
    'Bahasa pemrograman',
    'Framework',
    'Library dan integrasi',
    'Stack khusus dari konfigurasi',
  ]);
  assert.ok(stackOptions.options.Framework.some((option) => option.value === 'laravel'));
  assert.ok(
    stackOptions.options['Stack khusus dari konfigurasi'].some(
      (option) => option.value === 'custom-stack',
    ),
  );
  assert.match(notes[0], /Gin/);
  assert.doesNotMatch(notes[0], /^\s*\{/u);
  assert.equal(configured.docsLanguage, 'id');
  assert.equal(configured.validation, 'auto');
  assert.deepEqual(initial.stack, ['go', 'custom-stack']);
});

test('selecting Laravel automatically includes PHP and explains the relationship', async () => {
  const selects = ['id', 'id', 'ask', 'existing'];
  const notes = [];
  const io = {
    intro() {},
    note(message) {
      notes.push(message);
    },
    select: async () => selects.shift(),
    text: async () => 'ai-agent-docs',
    groupMultiselect: async () => ['laravel'],
    multiselect: async (options) => options.initialValues,
  };
  const configured = await configure(
    defaults(),
    { stack: [], evidence: [], commands: {}, ecosystems: [], sourceEvidence: [] },
    io,
  );

  assert.deepEqual(configured.stack, ['php', 'laravel']);
  assert.match(notes.at(-1), /PHP \(diperlukan oleh Laravel\)/u);
});

test('skill recommendations follow the selected stack but remain editable', () => {
  assert.deepEqual(recommendedSkills([]), [
    'quality',
    'docs',
    'contracts',
    'testing',
    'dependencies',
  ]);
  assert.deepEqual(recommendedSkills(['laravel', 'typescript']), [
    'quality',
    'docs',
    'contracts',
    'testing',
    'zero-any',
    'routes',
    'dependencies',
  ]);
  assert.deepEqual(recommendedSkills(['laravel'], true), [
    'quality',
    'docs',
    'contracts',
    'testing',
    'ui-size',
    'routes',
    'forms',
    'ui-tests',
    'accessibility',
    'dependencies',
  ]);
});

test('wizard preselects recommendations after the stack checkbox choice', async () => {
  const selects = ['id', 'en', 'ask', 'existing'];
  let skillInitialValues;
  const io = {
    intro() {},
    note() {},
    select: async () => selects.shift(),
    text: async () => 'ai-agent-docs',
    groupMultiselect: async () => ['laravel', 'typescript'],
    multiselect: async (options) => {
      if (options.message.includes('skills') || options.message.includes('Skill')) {
        skillInitialValues = options.initialValues;
      }
      return options.initialValues;
    },
  };
  await configure(
    defaults(),
    { stack: [], evidence: [], commands: {}, ecosystems: [], sourceEvidence: [] },
    io,
    { recommendSkills: true, includeDetectedStack: false },
  );
  assert.deepEqual(skillInitialValues, recommendedSkills(['laravel', 'typescript']));
});

test('doctor reports an orphaned project without configuration and never writes', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, '.cursor/rules/my-skill-gweh.mdc');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `<!-- BEGIN my-skill-gweh -->\nunknown\n<!-- END my-skill-gweh -->\n`);
  const before = await snapshot(root);
  const result = runCli(root, ['doctor', '--json']);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.state, 'orphaned');
  assert.ok(report.orphaned.includes('.cursor/rules/my-skill-gweh.mdc'));
  assert.deepEqual(await snapshot(root), before);
});

test('interactive update can skip a conflict and apply other safe files', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'] };
  await writeJson(root, CONFIG_PATH, config);
  const { generate } = await import('../dist/generator.js');
  await generate(root, config);
  const native = path.join(root, '.agents/skills/my-skill-gweh-quality/SKILL.md');
  await fs.writeFile(
    native,
    (await fs.readFile(native, 'utf8')).replace(
      'name: my-skill-gweh-quality',
      'name: my-custom-quality',
    ),
  );
  await writeJson(root, CONFIG_PATH, { ...config, docsLanguage: 'id' });
  const output = [];
  const context = {
    cwd: root,
    version: 'test',
    interactive: true,
    write: (text) => output.push(text),
    presets: path.join(root, 'presets'),
    prompts: {
      select: async () => 'skip',
      confirm: async () => true,
    },
  };
  const exitCode = await runCommand(parseCommand(['update']), context);
  assert.equal(exitCode, 1);
  assert.match(output.join('\n'), /Diterapkan sebagian/u);
  assert.match(await fs.readFile(native, 'utf8'), /name: my-custom-quality/u);
  assert.match(
    await fs.readFile(path.join(root, `${config.output}/engineering/docs.md`), 'utf8'),
    /Perbarui/u,
  );
});

test('interactive update resolves overlapping canonical edits per hunk and previews the result', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'], docsLanguage: 'en' };
  await writeJson(root, CONFIG_PATH, config);
  const { generate } = await import('../dist/generator.js');
  const { END_MARKER } = await import('../dist/managed-content.js');
  const { skillGuidePath } = await import('../dist/render.js');
  await generate(root, config);
  const relative = skillGuidePath(config.output, 'quality');
  const guide = path.join(root, relative);
  await fs.writeFile(
    guide,
    (await fs.readFile(guide, 'utf8'))
      .replace('Keep modules focused', 'Keep my modules focused')
      .replace(END_MARKER, '\n\nLocal-only note.\n' + END_MARKER),
  );
  await writeJson(root, CONFIG_PATH, { ...config, docsLanguage: 'id' });
  const selected = [];
  const output = [];
  const status = await runCommand(parseCommand(['update']), {
    cwd: root,
    version: 'test',
    interactive: true,
    write: (line) => output.push(line),
    presets: path.join(root, 'presets'),
    prompts: {
      select: async (options) => {
        if (/^(?:Conflict|Konflik)/u.test(String(options.message))) {
          selected.push(options.options.map((item) => item.value));
          return 'both';
        }
        return options.initialValue;
      },
      confirm: async () => true,
    },
  });
  assert.equal(status, 0, output.join('\n'));
  assert.ok(selected.length > 0, output.join('\n'));
  assert.ok(
    selected[0].includes('local') &&
      selected[0].includes('generated') &&
      selected[0].includes('both'),
  );
  assert.match(output.join('\n'), /Pratinjau isi akhir/u);
  assert.match(output.join('\n'), /\+Jaga modul tetap terfokus/u);
  const updated = await fs.readFile(guide, 'utf8');
  assert.match(updated, /Keep my modules focused/u);
  assert.match(updated, /Jaga modul tetap terfokus/u);
  assert.match(updated, /Local-only note/u);
});

test('interactive removal offers retaining an edited guide as a normal document', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  await writeJson(root, CONFIG_PATH, config);
  const { generate } = await import('../dist/generator.js');
  const { END_MARKER } = await import('../dist/managed-content.js');
  const { skillGuidePath } = await import('../dist/render.js');
  await generate(root, config);
  const source = skillGuidePath(config.output, 'quality');
  const sourcePath = path.join(root, source);
  await fs.writeFile(
    sourcePath,
    (await fs.readFile(sourcePath, 'utf8')).replace(
      END_MARKER,
      '\n\nKeep this design note.\n' + END_MARKER,
    ),
  );
  await writeJson(root, CONFIG_PATH, { ...config, skills: ['docs'] });
  const output = [];
  let sawRetainOption = false;
  const status = await runCommand(parseCommand(['update']), {
    cwd: root,
    version: 'test',
    interactive: true,
    write: (line) => output.push(line),
    presets: path.join(root, 'presets'),
    prompts: {
      select: async (options) => {
        if (String(options.message).includes(source)) {
          sawRetainOption = options.options.some((item) => item.value === 'retain');
          return 'retain';
        }
        return options.initialValue;
      },
      confirm: async () => true,
    },
  });
  assert.equal(status, 0, output.join('\n'));
  assert.equal(sawRetainOption, true);
  await assert.rejects(fs.access(sourcePath));
  const retainedDirectory = path.join(root, config.output, 'retained');
  const retained = await fs.readdir(retainedDirectory, { recursive: true });
  assert.ok(retained.some((file) => String(file).includes('quality.retained-')));
  const archivePath = retained.find((file) => String(file).includes('quality.retained-'));
  assert.match(
    await fs.readFile(path.join(retainedDirectory, archivePath), 'utf8'),
    /Keep this design note/u,
  );
});

test('interactive no-op update does not ask for a write confirmation', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  await writeJson(root, CONFIG_PATH, config);
  const { generate } = await import('../dist/generator.js');
  await generate(root, config);
  let confirmations = 0;
  const output = [];
  const status = await runCommand(parseCommand(['update']), {
    cwd: root,
    version: 'test',
    interactive: true,
    write: (line) => output.push(line),
    presets: path.join(root, 'presets'),
    prompts: {
      confirm: async () => {
        confirmations += 1;
        return true;
      },
    },
  });
  assert.equal(status, 0);
  assert.equal(confirmations, 0);
  assert.match(output.join('\n'), /Sudah terbaru/u);
});

test('declining final confirmation leaves the project untouched', async (t) => {
  const root = await fixture(t);
  await writeJson(root, CONFIG_PATH, defaults());
  const before = await snapshot(root);
  const command = parseCommand(['update']);
  const status = await runCommand(command, {
    cwd: root,
    version: '0.1.0',
    interactive: true,
    write() {},
    presets: path.join(root, 'isolated-config'),
    prompts: { confirm: async () => false },
  });
  assert.equal(status, 0);
  assert.deepEqual(await snapshot(root), before);
});
