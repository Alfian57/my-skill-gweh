import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaults } from '../dist/config.js';
import { doctor } from '../dist/doctor.js';
import { generate } from '../dist/generator.js';
import { projectGuidePath, render } from '../dist/render.js';
import { fixture } from './helpers.js';

async function writeFile(root, relative, content) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

test('release guide is omitted when the project has no Release Please evidence', async (t) => {
  const root = await fixture(t);
  const files = await render(root, defaults());

  assert.equal(files[projectGuidePath('ai-agent-docs', 'release')], undefined);
  assert.doesNotMatch(files['ai-agent-docs/README.md'], /project\/release\.md/u);
  assert.doesNotMatch(files[projectGuidePath('ai-agent-docs', 'workflow')], /release guide/u);
});

test('Release Please evidence adds localized release guidance and only includes Docker advice with Docker evidence', async (t) => {
  const root = await fixture(t);
  await writeFile(
    root,
    '.github/workflows/release.yml',
    'name: Release\non:\n  push:\n    branches: [main]\njobs:\n  release:\n    steps:\n      - uses: googleapis/release-please-action@v5\n',
  );

  const withoutDocker = await render(root, { ...defaults(), docsLanguage: 'en' });
  const releasePath = projectGuidePath('ai-agent-docs', 'release');
  const releaseGuide = withoutDocker[releasePath];
  assert.ok(releaseGuide);
  assert.match(releaseGuide, /\.github\/workflows\/release\.yml/u);
  assert.match(releaseGuide, /Conventional Commit pull request title/u);
  assert.doesNotMatch(releaseGuide, /Docker evidence/u);
  assert.match(withoutDocker['ai-agent-docs/README.md'], /project\/release\.md/u);
  assert.match(
    withoutDocker[projectGuidePath('ai-agent-docs', 'workflow')],
    /\[Release workflow guide\]\(release\.md\)/u,
  );

  await writeFile(root, 'Dockerfile', 'FROM node:24\n');
  const withDocker = await render(root, { ...defaults(), docsLanguage: 'id' });
  const localizedGuide = withDocker[releasePath];
  assert.ok(localizedGuide);
  assert.match(localizedGuide, /Bukti Release Please/u);
  assert.match(localizedGuide, /Bukti Docker: `Dockerfile`/u);
  assert.match(localizedGuide, /tag versi dan commit-SHA/u);
});

test('release action detection is independent of config files and removed guidance is cleaned up on update', async (t) => {
  const root = await fixture(t);
  const config = defaults();
  await writeFile(
    root,
    '.github/workflows/release.yml',
    'jobs:\n  release:\n    steps:\n      - uses: googleapis/release-please-action@v5\n',
  );
  const first = await generate(root, config);
  const releasePath = projectGuidePath(config.output, 'release');
  assert.ok(first.written.includes(releasePath));
  assert.equal((await doctor(root, config)).invalidReferences.length, 0);

  await fs.rm(path.join(root, '.github/workflows/release.yml'));
  const updated = await generate(root, config);
  assert.ok(updated.removed.includes(releasePath));
  await assert.rejects(fs.access(path.join(root, releasePath)));
  assert.equal((await doctor(root, config)).invalidReferences.length, 0);
});
