import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { packageMetadata, runNpm, runNode } from './lib.mjs';

const argument = process.argv[2];
if (!argument) throw new Error('Usage: npm run test:package -- path/to/package.tgz');
const tarball = path.resolve(argument);
const metadata = await packageMetadata();
const temporary = await mkdtemp(path.join(os.tmpdir(), 'my-skill-gweh-package-'));
try {
  const installation = path.join(temporary, 'installation');
  const project = path.join(temporary, 'project with spaces');
  await mkdir(project, { recursive: true });
  const environment = { ...process.env, XDG_CONFIG_HOME: path.join(temporary, 'user-config') };
  // The isolated install forbids all scripts; do not inherit the parent project's allowlist.
  for (const key of Object.keys(environment)) {
    if (/^npm_config_allow_scripts/iu.test(key)) delete environment[key];
  }
  // Installation must succeed with lifecycle hooks disabled; no source files or devDependencies are available.
  runNpm(
    ['install', '--prefix', installation, '--ignore-scripts', '--no-audit', '--no-fund', tarball],
    {
      cwd: temporary,
      env: environment,
    },
  );
  const installed = path.join(installation, 'node_modules', metadata.name);
  const binary = path.join(installed, 'dist', 'cli.js');
  const execute = (args) =>
    runNode([binary, ...args], {
      cwd: project,
      env: environment,
      stdio: 'pipe',
    });
  assert.equal(execute(['--version']).trim(), metadata.version);
  const configFile = path.join(temporary, 'choices.json');
  const config = {
    version: 1,
    language: 'id',
    docsLanguage: 'en',
    output: 'preview docs (#1)',
    agents: ['codex', 'claude'],
    skills: ['quality', 'docs', 'testing'],
    validation: 'ask',
    git: 'existing',
    stack: ['typescript'],
  };
  await writeFile(configFile, JSON.stringify(config));
  const generated = JSON.parse(
    execute(['init', '--config', configFile, '--non-interactive', '--json']),
  );
  assert.ok(generated.changes.length > 0);
  assert.deepEqual(generated.conflicts, []);
  const updated = JSON.parse(execute(['update', '--non-interactive', '--json']));
  assert.equal(updated.status, 'applied');
  assert.deepEqual(updated.changes, []);
  assert.deepEqual(updated.conflicts, []);
  assert.deepEqual(updated.planned, { writes: [], removals: [], backups: [], metadata: [] });
  assert.deepEqual(updated.written, []);
  assert.deepEqual(updated.removed, []);
  assert.deepEqual(updated.backups, []);
  assert.deepEqual(updated.skipped, []);
  assert.deepEqual(updated.diagnostics, []);
  const report = JSON.parse(execute(['doctor', '--json']));
  assert.equal(report.state, 'initialized');
  assert.equal(report.lock.state, 'none');
  for (const field of [
    'missing',
    'conflicts',
    'drift',
    'orphaned',
    'diagnostics',
    'invalidReferences',
  ]) {
    assert.deepEqual(report[field], [], `doctor ${field}`);
  }
  const skill = await readFile(
    path.join(project, '.agents/skills/my-skill-gweh-quality/SKILL.md'),
    'utf8',
  );
  assert.ok(skill.startsWith('---\n'));
  const installedMetadata = JSON.parse(
    await readFile(path.join(installed, 'package.json'), 'utf8'),
  );
  assert.equal(installedMetadata.bin['my-skill-gweh'], 'dist/cli.js');
  console.log(`Installed tarball passed: --version, init, update, doctor (${metadata.version}).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
