import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaults, CONFIG_PATH } from '../dist/config.js';
import { parseCommand } from '../dist/cli/options.js';
import { runCommand } from '../dist/cli/commands.js';
import { CancelledError } from '../dist/errors.js';
import { configure } from '../dist/cli/wizard.js';
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
  assert.deepEqual(JSON.parse(repeated.stdout), { changes: [], conflicts: [] });
  assert.equal(
    runCli(root, args).status,
    1,
    'init --config must not bypass the existing-project guard',
  );
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
    configure(defaults(), { stack: [], evidence: [], commands: {} }, io),
    CancelledError,
  );
});

test('wizard preserves existing choices and can configure Indonesian documentation', async () => {
  const initial = { ...defaults(), stack: ['go'], validation: 'auto', git: 'staging' };
  const selects = ['id', 'id', 'auto', 'staging'];
  const text = ['custom docs', 'go,gin'];
  const io = {
    intro() {},
    note() {},
    select: async (options) => {
      if (options.message === 'Kebijakan pengujian') assert.equal(options.initialValue, 'auto');
      return selects.shift();
    },
    text: async () => text.shift(),
    multiselect: async (options) => options.initialValues,
  };
  const configured = await configure(
    initial,
    { stack: ['go'], evidence: ['go.mod'], commands: {} },
    io,
  );
  assert.deepEqual(configured.stack, ['go', 'gin']);
  assert.equal(configured.docsLanguage, 'id');
  assert.equal(configured.validation, 'auto');
  assert.deepEqual(initial.stack, ['go']);
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
