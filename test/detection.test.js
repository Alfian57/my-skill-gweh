import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { detect } from '../dist/detection.js';
import { fixture, writeJson } from './helpers.js';

test('empty project has no fabricated stack or commands', async (t) => {
  assert.deepEqual(await detect(await fixture(t)), {
    stack: [],
    evidence: [],
    commands: {},
    ecosystems: [],
    sourceEvidence: [],
    diagnostics: [],
  });
});

test('detects combined Laravel/Inertia and preserves script declarations without executing them', async (t) => {
  const root = await fixture(t);
  const script = "node -e \"require('node:fs').writeFileSync('SHOULD_NOT_EXIST','executed')\"";
  await writeJson(root, 'package.json', {
    dependencies: { react: '*', '@inertiajs/react': '*' },
    devDependencies: { typescript: '*' },
    scripts: { test: script },
  });
  await writeJson(root, 'composer.json', { require: { 'laravel/framework': '*' } });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.tsx'), 'export const App = () => null;');
  await fs.mkdir(path.join(root, 'app'), { recursive: true });
  await fs.writeFile(path.join(root, 'app', 'index.php'), '<?php');
  const result = await detect(root);
  assert.deepEqual(result.stack, ['typescript', 'php', 'laravel', 'react', 'inertia']);
  assert.deepEqual(result.ecosystems, ['javascript-packages', 'composer']);
  assert.deepEqual(result.sourceEvidence, ['.php', '.tsx']);
  assert.deepEqual(result.evidence, ['package.json', 'composer.json']);
  assert.equal(result.commands.test, script);
  await assert.rejects(fs.access(path.join(root, 'SHOULD_NOT_EXIST')));
});

test('package manifests do not imply source languages and generated folders are ignored', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'package.json', {
    devDependencies: { typescript: '*' },
  });
  assert.deepEqual((await detect(root)).stack, []);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'app.ts'), 'export const answer: number = 42;');
  for (const directory of [
    'node_modules/stub',
    'vendor/package',
    'dist',
    'build',
    '.next',
    'coverage',
  ]) {
    await fs.mkdir(path.join(root, directory), { recursive: true });
    await fs.writeFile(path.join(root, directory, 'generated.php'), '<?php');
  }

  const result = await detect(root);
  assert.deepEqual(result.stack, ['typescript']);
  assert.deepEqual(result.ecosystems, ['javascript-packages']);
  assert.deepEqual(result.sourceEvidence, ['.ts']);
});

test('source detection does not follow symlinked directories', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await fs.writeFile(path.join(outside, 'main.go'), 'package main');
  try {
    await fs.symlink(outside, path.join(root, 'linked-source'), 'dir');
  } catch (error) {
    if (process.platform === 'win32' && error?.code === 'EPERM') {
      t.skip('Windows user does not have permission to create directory symlinks.');
      return;
    }
    throw error;
  }
  assert.deepEqual((await detect(root)).stack, []);
});

test('source detection stops at nested git repositories and initialized child projects', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'main.go'), 'package main');
  for (const directory of ['apps/git-child', 'apps/initialized-child']) {
    await fs.mkdir(path.join(root, directory), { recursive: true });
    await fs.writeFile(path.join(root, directory, 'page.tsx'), 'export default function Page() {}');
  }
  await fs.mkdir(path.join(root, 'apps/git-child/.git'), { recursive: true });
  await fs.mkdir(path.join(root, 'apps/initialized-child/.my-skill-gweh'), { recursive: true });
  await fs.writeFile(path.join(root, 'apps/initialized-child/.my-skill-gweh/config.json'), '{}');

  const result = await detect(root);
  assert.deepEqual(result.stack, ['go']);
  assert.deepEqual(result.sourceEvidence, ['.go']);
  assert.equal(result.uiEvidence, undefined);
});

test('project manifest symlinks are skipped with a diagnostic', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await writeJson(outside, 'package.json', { dependencies: { next: '1' } });
  try {
    await fs.symlink(path.join(outside, 'package.json'), path.join(root, 'package.json'));
  } catch (error) {
    if (process.platform === 'win32' && error?.code === 'EPERM') {
      t.skip('Windows user does not have permission to create file symlinks.');
      return;
    }
    throw error;
  }
  const result = await detect(root);
  assert.deepEqual(result.stack, []);
  assert.match(result.diagnostics.join('\n'), /Skipped symlinked project input package\.json/u);
});

test('UI evidence comes from UI source paths rather than a JavaScript package manifest', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'package.json', { scripts: { build: 'vite build' } });
  await fs.writeFile(path.join(root, 'artisan.php'), '<?php');
  assert.equal((await detect(root)).uiEvidence, undefined);
  await fs.mkdir(path.join(root, 'resources/views'), { recursive: true });
  await fs.writeFile(path.join(root, 'resources/views/home.blade.php'), '<main></main>');
  assert.equal((await detect(root)).uiEvidence, true);
});

test('Go detection ignores commented dependencies', async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'main.go'), 'package main');
  await fs.writeFile(
    path.join(root, 'go.mod'),
    'module example.test\n// require github.com/gin-gonic/gin v1.0.0\n',
  );
  assert.deepEqual((await detect(root)).stack, ['go']);
  await fs.appendFile(
    path.join(root, 'go.mod'),
    'require (\n github.com/gin-gonic/gin v1.0.0\n)\n',
  );
  assert.deepEqual((await detect(root)).stack, ['go', 'gin']);
});

test('invalid manifests identify their source rather than crashing with a property error', async (t) => {
  const root = await fixture(t);
  const file = path.join(root, 'package.json');
  await fs.writeFile(file, 'broken JSON');
  assert.match((await detect(root)).diagnostics.join('\n'), /Invalid JSON in .*package.json/u);
  await writeJson(root, 'package.json', { scripts: { test: false } });
  await assert.rejects(detect(root), /Invalid scripts.*package.json/);
  await fs.writeFile(file, 'null');
  assert.match((await detect(root)).diagnostics.join('\n'), /expected a JSON object/u);
});

test('package manager follows packageManager metadata or one unique lockfile', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'package.json', { packageManager: 'pnpm@9.15.0' });
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  assert.equal((await detect(root)).packageManager, 'pnpm');

  await fs.rm(path.join(root, 'package.json'));
  assert.equal((await detect(root)).packageManager, 'pnpm');

  await fs.writeFile(path.join(root, 'yarn.lock'), '# yarn lock');
  const ambiguous = await detect(root);
  assert.equal(ambiguous.packageManager, undefined);
  assert.equal(ambiguous.packageManagerAmbiguous, true);
  assert.deepEqual(ambiguous.packageManagerEvidence, ['pnpm-lock.yaml', 'yarn.lock']);
});
