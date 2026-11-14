import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaults } from '../dist/config.js';
import { skillIds } from '../dist/catalog.js';
import { doctor, isHealthy } from '../dist/doctor.js';
import { generate } from '../dist/generator.js';
import { localLink, projectGuidePath, render, skillGuidePath } from '../dist/render.js';
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
    const guide = files[skillGuidePath(config.output, skill)];
    const nativeSkillFile = `.agents/skills/my-skill-gweh-${skill}/SKILL.md`;
    const nativeSkill = files[nativeSkillFile];
    assert.ok(guide, `${skill} guide exists`);
    assert.ok(nativeSkill, `${skill} native skill exists`);
    assert.ok(
      (guide.match(/^## /gmu) ?? []).length >= (skill === 'mascot' ? 1 : 2),
      `${skill} has discoverable sections`,
    );
    if (skill === 'mascot')
      assert.ok(
        (files[`${config.output}/application/mascot-concepts.md`].match(/^## /gmu) ?? []).length >=
          2,
      );
    assert.match(guide, /^- /mu, `${skill} has actionable rules`);
    assert.match(nativeSkill, /Follow the project guide:|Ikuti panduan proyek:/u);
    assert.ok(
      nativeSkill.includes(`(${localLink(nativeSkillFile, skillGuidePath(config.output, skill))})`),
    );
    assert.doesNotMatch(nativeSkill, /Review checklist|Checklist review/u);
  }

  const nativeSkills = Object.keys(files).filter((file) =>
    /\/my-skill-gweh-[^/]+\/SKILL\.md$/u.test(file),
  );
  assert.ok(nativeSkills.length > config.skills.length);
  for (const file of nativeSkills) {
    const skill = file.match(/\/my-skill-gweh-([^/]+)\/SKILL\.md$/u)?.[1];
    assert.ok(skill && config.skills.includes(skill));
    assert.ok(files[file].includes(`(${localLink(file, skillGuidePath(config.output, skill))})`));
  }

  assert.match(files[`${config.output}/README.md`], /engineering\/quality\.md/u);
  assert.match(files[`${config.output}/README.md`], /project\/context\.md/u);
  assert.match(
    files[skillGuidePath(config.output, 'zero-any')],
    /no TypeScript files|tidak menemukan berkas TypeScript/u,
  );
});

test('mascot guidance localizes its full workflow and stays opt-in for custom output paths', async (t) => {
  const root = await fixture(t);
  const output = 'team docs/agent guides (#1)';
  const absent = await render(root, { ...defaults(), output, agents: ['codex'] });
  assert.equal(absent[skillGuidePath(output, 'mascot')], undefined);
  assert.equal(absent['.agents/skills/my-skill-gweh-mascot/SKILL.md'], undefined);

  const expected = {
    en: [
      'use that identity for poses and variations',
      'attach the guide image as visual input',
      'Start a new identity or redesign only when the developer asks',
    ],
    id: [
      'gunakan identitas itu untuk pose dan variasi',
      'lampirkan gambar guide sebagai input visual',
      'Mulai identitas baru atau redesign hanya jika developer memintanya',
    ],
  };
  for (const language of ['id', 'en']) {
    const config = {
      ...defaults(),
      output,
      docsLanguage: language,
      agents: ['codex'],
      skills: ['mascot'],
    };
    const files = await render(root, config);
    const guide = files[skillGuidePath(output, 'mascot')];
    const concepts = files[`${output}/application/mascot-concepts.md`];
    const adapterPath = '.agents/skills/my-skill-gweh-mascot/SKILL.md';
    const adapter = files[adapterPath];
    assert.ok(guide);
    assert.ok(concepts);
    assert.ok(adapter);
    for (const phrase of expected[language]) assert.ok(guide.includes(phrase), phrase);
    assert.ok(
      concepts.includes(language === 'en' ? 'four separate PNGs' : 'empat file PNG terpisah'),
    );
    assert.ok(
      concepts.includes(
        language === 'en'
          ? 'without another approval prompt'
          : 'tanpa meminta persetujuan tambahan',
      ),
    );
    assert.ok(guide.length < 1_500, `Mascot entry guide should stay concise (${language})`);
    assert.ok(adapter.includes(`(${localLink(adapterPath, skillGuidePath(output, 'mascot'))})`));
    assert.match(files[`${output}/README.md`], /application\/mascot\.md/u);
  }
});

test('turning off mascot guidance preserves project identity notes and image assets', async (t) => {
  const root = await fixture(t);
  const output = 'ai agent docs';
  const enabled = {
    ...defaults(),
    output,
    agents: ['codex'],
    skills: ['quality', 'mascot'],
  };
  await generate(root, enabled);

  const profile = `${output}/project/mascot.md`;
  const asset = 'assets/mascot/run-1/guide.png';
  await writeFile(root, profile, '# Project mascot\n\nActive reference is saved locally.\n');
  await writeFile(root, asset, 'test reference image');
  assert.equal(isHealthy(await doctor(root)), true);

  const disabled = { ...enabled, skills: ['quality'] };
  const result = await generate(root, disabled);
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, '.my-skill-gweh/config.json'), 'utf8')).skills,
    ['quality'],
  );
  await assert.rejects(fs.access(path.join(root, skillGuidePath(output, 'mascot'))));
  await assert.rejects(fs.access(path.join(root, '.agents/skills/my-skill-gweh-mascot/SKILL.md')));
  await assert.rejects(fs.access(path.join(root, `${output}/application/mascot-concepts.md`)));
  assert.equal(
    await fs.readFile(path.join(root, profile), 'utf8'),
    '# Project mascot\n\nActive reference is saved locally.\n',
  );
  assert.equal(await fs.readFile(path.join(root, asset), 'utf8'), 'test reference image');
  assert.equal(isHealthy(await doctor(root)), true);
});

test('database migration policy is always available even when contracts is optional', async (t) => {
  const root = await fixture(t);

  for (const language of ['id', 'en']) {
    const config = { ...defaults(), docsLanguage: language, skills: ['contracts'] };
    const files = await render(root, config);
    const guide = files[skillGuidePath(config.output, 'contracts')];
    const nativeSkill = files['.agents/skills/my-skill-gweh-contracts/SKILL.md'];
    const alwaysOn = files['AGENTS.md'];

    assert.match(
      alwaysOn,
      /ask whether production may be reset|tanyakan apakah production boleh di-fresh/u,
    );
    assert.match(alwaysOn, /edit existing migrations|edit migrasi yang ada/u);
    assert.match(alwaysOn, /add a data-preserving migration|tambahkan migrasi yang menjaga data/u);
    assert.doesNotMatch(
      guide,
      /ask whether production may be reset|tanyakan apakah production boleh di-fresh/u,
    );
    assert.match(nativeSkill, /engineering\/contracts\.md/u);
    assert.doesNotMatch(nativeSkill, /fresh database reset|database boleh di-fresh/u);
  }
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
  const context = await fs.readFile(
    path.join(root, projectGuidePath(config.output, 'context')),
    'utf8',
  );

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
  const context = files[projectGuidePath('ai-agent-docs', 'context')];

  assert.match(context, /Go/u);
  assert.match(context, /Gin/u);
  assert.match(context, /example\.com\/service/u);
  assert.match(context, /1\.23/u);
  assert.match(context, /cmd\/server\/main\.go/u);
  assert.match(context, /internal\/handler\/health\.go/u);
});

test('selected stack stays authoritative while detected evidence remains visible', async (t) => {
  const root = await fixture(t);
  await writeFile(
    root,
    'go.mod',
    'module example.com/service\n\ngo 1.23\n\nrequire github.com/gin-gonic/gin v1.10.0\n',
  );
  await writeFile(root, 'cmd/server/main.go', 'package main\n');
  const files = await render(root, {
    ...defaults(),
    stack: [],
    agents: ['codex'],
    skills: ['routes'],
  });
  const context = files[projectGuidePath('ai-agent-docs', 'context')];
  const workflow = files[projectGuidePath('ai-agent-docs', 'workflow')];
  assert.match(context, /Selected stack[\s\S]*?No stack evidence found/u);
  assert.match(context, /Detected stack evidence[\s\S]*?Go[\s\S]*?Gin/u);
  assert.match(workflow, /No stack selected/u);
  assert.doesNotMatch(files[skillGuidePath('ai-agent-docs', 'routes')], /Laravel: named route/u);
});

test('native skills keep all relevant context and examples match the selected stack', async (t) => {
  const root = await fixture(t);
  await writeFile(
    root,
    'go.mod',
    'module example.com/service\n\ngo 1.23\n\nrequire github.com/gin-gonic/gin v1.10.0\n',
  );
  await writeFile(root, 'cmd/server/main.go', 'package main\n');
  const files = await render(root, {
    ...defaults(),
    agents: ['codex'],
    skills: ['routes', 'zero-any', 'forms'],
    stack: ['gin'],
  });
  const routesNative = files['.agents/skills/my-skill-gweh-routes/SKILL.md'];
  const zeroAnyNative = files['.agents/skills/my-skill-gweh-zero-any/SKILL.md'];
  assert.match(routesNative, /application\/routes\.md/u);
  assert.match(zeroAnyNative, /engineering\/zero-any\.md/u);
  assert.doesNotMatch(routesNative, /For Gin|Untuk Gin/u);
  assert.doesNotMatch(files[skillGuidePath('ai-agent-docs', 'routes')], /Laravel: named route/u);
  assert.doesNotMatch(
    files[skillGuidePath('ai-agent-docs', 'forms')],
    /Blade: field error and CSRF/u,
  );
});

test('project commands use the detected package manager and avoid guesses when ambiguous', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'package.json', { scripts: { build: 'vite build' } });
  await fs.writeFile(path.join(root, 'yarn.lock'), '# yarn');
  let files = await render(root, { ...defaults(), agents: ['codex'] });
  let context = files[projectGuidePath('ai-agent-docs', 'context')];
  assert.match(context, /yarn run build/u);
  assert.doesNotMatch(context, /npm run build/u);

  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  files = await render(root, { ...defaults(), agents: ['codex'] });
  context = files[projectGuidePath('ai-agent-docs', 'context')];
  assert.match(context, /package manager not identified/u);
  assert.doesNotMatch(context, /(?:npm|pnpm|yarn|bun) run build/u);
});

test('script names with spaces are emitted as quoted invocations', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'package.json', { scripts: { 'test ui': 'node tests/ui.js' } });
  await fs.writeFile(path.join(root, 'package-lock.json'), '{"packages":{}}');
  const files = await render(root, { ...defaults(), agents: ['codex'], skills: ['quality'] });
  const context = files[projectGuidePath('ai-agent-docs', 'context')];
  assert.match(context, /npm run 'test ui'/u);
});

test('Next.js guidance follows the detected router instead of assuming App Router', async (t) => {
  const appRoot = await fixture(t);
  await writeJson(appRoot, 'package.json', { dependencies: { next: '^15.0.0' } });
  await writeFile(appRoot, 'app/page.tsx', 'export default function Page() { return null; }');
  const appFiles = await render(appRoot, {
    ...defaults(),
    agents: ['codex'],
    skills: ['quality', 'routes'],
    stack: ['nextjs'],
  });
  assert.match(appFiles[skillGuidePath('ai-agent-docs', 'quality')], /Next.js App Router/u);
  assert.match(appFiles[projectGuidePath('ai-agent-docs', 'context')], /App Router/u);

  const pagesRoot = await fixture(t);
  await writeJson(pagesRoot, 'package.json', { dependencies: { next: '^15.0.0' } });
  await writeFile(pagesRoot, 'pages/index.tsx', 'export default function Page() { return null; }');
  const pagesFiles = await render(pagesRoot, {
    ...defaults(),
    agents: ['codex'],
    skills: ['quality', 'routes'],
    stack: ['nextjs'],
  });
  assert.match(pagesFiles[skillGuidePath('ai-agent-docs', 'quality')], /Pages Router/u);
  assert.doesNotMatch(
    pagesFiles[skillGuidePath('ai-agent-docs', 'quality')],
    /Server Components as the default/u,
  );
});

test('agent compatibility outputs only the necessary instruction entrypoint', async (t) => {
  const root = await fixture(t);
  const files = await render(root, { ...defaults(), agents: ['claude'], skills: ['quality'] });
  assert.ok(files['CLAUDE.md']);
  assert.equal(files['AGENTS.md'], undefined);
  assert.ok(files['.claude/skills/my-skill-gweh-quality/SKILL.md']);
});

test('dependency evidence does not claim a missing Composer lockfile or wrong JS lockfile', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'composer.json', {
    require: { 'laravel/framework': '^13.0' },
  });
  await writeJson(root, 'package.json', {
    packageManager: 'pnpm@9.0.0',
    dependencies: { react: '^19.0.0' },
  });
  await fs.writeFile(path.join(root, 'package-lock.json'), '{"packages":{}}');
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
  const files = await render(root, {
    ...defaults(),
    agents: ['codex'],
    stack: ['laravel', 'react'],
  });
  const context = files[projectGuidePath('ai-agent-docs', 'context')];
  assert.match(context, /Dependency Laravel.*composer\.json`/u);
  assert.doesNotMatch(context, /Dependency Laravel.*composer\.lock/u);
  assert.match(context, /Dependency React.*package\.json`/u);
  assert.doesNotMatch(context, /Dependency React.*package-lock\.json/u);
  assert.match(context, /declares pnpm, but lockfiles indicate npm/u);
});

test('malformed optional lockfiles are reported and do not silently erase project facts', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'package.json', {
    packageManager: 'npm@11.0.0',
    dependencies: { react: '^19.0.0' },
  });
  await fs.writeFile(path.join(root, 'package-lock.json'), '{broken');
  const files = await render(root, {
    ...defaults(),
    agents: ['codex'],
    skills: ['quality'],
    stack: ['react'],
  });
  const context = files[projectGuidePath('ai-agent-docs', 'context')];
  assert.match(context, /Invalid JSON in package-lock\.json/u);
  assert.match(context, /Dependency React/u);
  assert.match(context, /`npm`/u);
});
