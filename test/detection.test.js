import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { detect } from '../dist/detection.js';
import { fixture, writeJson } from './helpers.js';

test('empty project has no fabricated stack or commands', async (t) => {
  assert.deepEqual(await detect(await fixture(t)), { stack: [], evidence: [], commands: {} });
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
  const result = await detect(root);
  assert.deepEqual(result.stack, [
    'javascript',
    'typescript',
    'react',
    'inertia',
    'php',
    'laravel',
  ]);
  assert.equal(result.commands.test, script);
  await assert.rejects(fs.access(path.join(root, 'SHOULD_NOT_EXIST')));
});

test('Go detection ignores commented dependencies', async (t) => {
  const root = await fixture(t);
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
