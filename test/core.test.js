import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { defaults, detect, generate, safe, render } from '../dist/core.js';
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'msg-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('mixed stack detection never executes project scripts', async (t) => {
  const dir = await fixture(t);
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      dependencies: { next: '1', react: '1', typescript: '1' },
      scripts: { test: 'false' },
    }),
  );
  await fs.writeFile(path.join(dir, 'app.tsx'), 'export const App = () => null;');
  assert.deepEqual((await detect(dir)).stack, ['typescript', 'nextjs', 'react']);
});

test('generated workflow separates languages and explains framework requirements', async (t) => {
  const dir = await fixture(t);
  const config = { ...defaults(), stack: ['laravel'] };
  const files = await render(dir, config);
  assert.match(
    files[`${config.output}/project/workflow.md`],
    /Languages: PHP \(required by Laravel\)/u,
  );
  assert.match(files[`${config.output}/project/workflow.md`], /Frameworks: Laravel/u);
});
test('feature PR workflow includes actionable steps and approval boundaries', async (t) => {
  const dir = await fixture(t);
  const config = { ...defaults(), git: 'feature-pr' };
  const files = await render(dir, config);
  assert.match(files[`${config.output}/project/workflow.md`], /Create a focused feature branch/u);
  assert.match(
    files[`${config.output}/project/workflow.md`],
    /Ask before committing, pushing, or opening a PR/u,
  );
});
test('dry-run, repeatability, edited content preservation', async (t) => {
  const dir = await fixture(t),
    c = defaults();
  await generate(dir, c, true);
  assert.deepEqual(await fs.readdir(dir), []);
  await generate(dir, c);
  assert.equal((await generate(dir, c, true)).changes.length, 0);
  const f = path.join(dir, c.output, 'engineering', 'quality.md');
  await fs.appendFile(f, 'User note\n');
  await generate(dir, c);
  assert.match(await fs.readFile(f, 'utf8'), /User note/);
  await fs.writeFile(f, (await fs.readFile(f, 'utf8')).replace('Keep modules', 'Edited modules'));
  const merged = await generate(dir, c);
  assert.deepEqual(merged.conflicts, []);
  assert.match(await fs.readFile(f, 'utf8'), /Edited modules/u);
  assert.match(await fs.readFile(f, 'utf8'), /User note/u);
});
test('existing AGENTS content and custom folder remain portable', async (t) => {
  const dir = await fixture(t),
    c = defaults();
  c.output = 'custom docs';
  await fs.writeFile(path.join(dir, 'AGENTS.md'), 'Existing instructions\n');
  await generate(dir, c);
  assert.match(await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8'), /^Existing instructions/);
  const files = await render(dir, c);
  assert.ok(files['.github/skills/my-skill-gweh-quality/SKILL.md']);
  assert.throws(() => safe(dir, '../outside'));
});
