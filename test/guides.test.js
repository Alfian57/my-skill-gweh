import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaults } from '../dist/config.js';
import { skillIds } from '../dist/catalog.js';
import { doctor, isHealthy } from '../dist/doctor.js';
import { generate } from '../dist/generator.js';
import { render } from '../dist/render.js';
import { fixture, writeJson } from './helpers.js';

async function writeFile(root, relative, content) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

test('every selected skill renders detailed guidance and native agent instructions', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), skills: [...skillIds] };
  const files = await render(root, config);

  for (const skill of config.skills) {
    const guide = files[`${config.output}/${skill}.md`];
    const nativeSkill = files[`.agents/skills/my-skill-gweh-${skill}/SKILL.md`];
    assert.ok(guide, `${skill} guide exists`);
    assert.ok(nativeSkill, `${skill} native skill exists`);
    assert.ok((guide.match(/^## /gmu) ?? []).length >= 2, `${skill} has detailed sections`);
    assert.match(guide, /^- /mu, `${skill} has actionable rules`);
    assert.match(nativeSkill, /^## (Apply this skill|Terapkan skill ini)$/mu);
    assert.match(nativeSkill, /Read the full guide|Baca panduan lengkap/u);
    assert.match(nativeSkill, /Project context map|Peta konteks proyek/u);
  }

  assert.match(files[`${config.output}/README.md`], /project-context\.md/u);
  assert.match(
    files[`${config.output}/zero-any.md`],
    /no TypeScript files|tidak menemukan berkas TypeScript/u,
  );
});

test('project map uses manifest and path evidence without running scripts or exposing env values', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'composer.json', {
    name: 'acme/laravel-demo',
    require: { php: '^8.3', 'laravel/framework': '^13.17' },
    scripts: { test: 'touch SCRIPT_WAS_RUN' },
  });
  await writeJson(root, 'composer.lock', {
    packages: [{ name: 'laravel/framework', version: 'v13.17.2' }],
    'packages-dev': [],
  });
  await writeJson(root, 'package.json', {
    name: 'laravel-demo-ui',
    scripts: { build: 'touch SCRIPT_WAS_RUN', dev: 'vite' },
  });
  await writeJson(root, 'package-lock.json', { packages: {} });
  await writeFile(root, '.env', 'DB_PASSWORD=never-leak-this-value\n');
  await writeFile(root, 'app/Models/User.php', '<?php\n');
  await writeFile(root, 'routes/web.php', '<?php\n');
  await writeFile(root, 'database/migrations/0001_create_users.php', '<?php\n');
  await writeFile(root, 'tests/Feature/UserTest.php', '<?php\n');
  await writeFile(root, 'AGENTS.md', 'Local agent instructions\n');
  await writeFile(root, '.agents/skills/existing/SKILL.md', '# Existing skill\n');

  const config = { ...defaults(), output: 'app/ai-agent-docs', stack: ['laravel'] };
  await generate(root, config);
  const context = await fs.readFile(path.join(root, config.output, 'project-context.md'), 'utf8');

  assert.match(context, /PHP requirement.*\^8\.3/u);
  assert.match(context, /v13\.17\.2/u);
  assert.match(context, /npm run build/u);
  assert.match(context, /composer test/u);
  assert.doesNotMatch(context, /composer post-/u);
  assert.match(context, /routes\/web\.php/u);
  assert.match(context, /app\/Models\/User\.php/u);
  assert.match(context, /tests\/Feature\/UserTest\.php/u);
  assert.match(context, /AGENTS\.md/u);
  assert.match(context, /\.agents\/skills\/existing\/SKILL\.md/u);
  assert.doesNotMatch(context, /never-leak-this-value/u);
  assert.doesNotMatch(context, /ai-agent-docs\//u);
  assert.equal(
    await fs.stat(path.join(root, 'SCRIPT_WAS_RUN')).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.ok(isHealthy(await doctor(root, config)));
});

test('Go/Gin context is grounded in go.mod and source paths', async (t) => {
  const root = await fixture(t);
  await writeFile(
    root,
    'go.mod',
    'module example.com/service\n\ngo 1.23\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n)\n',
  );
  await writeFile(root, 'cmd/server/main.go', 'package main\n');
  await writeFile(root, 'internal/handler/health.go', 'package handler\n');
  const files = await render(root, defaults());
  const context = files['ai-agent-docs/project-context.md'];

  assert.match(context, /Go/u);
  assert.match(context, /Gin/u);
  assert.match(context, /example\.com\/service/u);
  assert.match(context, /1\.23/u);
  assert.match(context, /cmd\/server\/main\.go/u);
  assert.match(context, /internal\/handler\/health\.go/u);
});
