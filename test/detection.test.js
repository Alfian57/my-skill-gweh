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
  await assert.rejects(detect(root), /Invalid JSON.*package.json/);
  await writeJson(root, 'package.json', { scripts: { test: false } });
  await assert.rejects(detect(root), /Invalid scripts.*package.json/);
  await fs.writeFile(file, 'null');
  await assert.rejects(detect(root), /Invalid project manifest/);
});
