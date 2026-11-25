import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaults, BASELINE_PATH, CONFIG_PATH, MANIFEST_PATH } from '../dist/config.js';
import {
  generate,
  planGeneration,
  commitGeneration,
  previewGeneration,
} from '../dist/generator.js';
import {
  fingerprint,
  managedContentFingerprint,
  BEGIN_MARKER,
  END_MARKER,
  replaceManagedContent,
} from '../dist/managed-content.js';
import { localLink, projectGuidePath, render, skillGuidePath } from '../dist/render.js';
import { doctor, isHealthy } from '../dist/doctor.js';
import { fixture, snapshot, writeJson } from './helpers.js';

test('native skills and editor rules start with discoverable frontmatter', async (t) => {
  const root = await fixture(t);
  await generate(root, defaults());
  const files = await snapshot(root);
  const metadataFiles = Object.keys(files).filter(
    (file) =>
      file.endsWith('/SKILL.md') || file.endsWith('.mdc') || file.startsWith('.windsurf/rules/'),
  );
  assert.ok(metadataFiles.length >= 6);
  for (const file of metadataFiles) {
    assert.ok(files[file].startsWith('---\n'), file);
    assert.ok(files[file].indexOf('\n---\n') < files[file].indexOf(BEGIN_MARKER), file);
  }
  const preview = await generate(root, defaults(), true);
  assert.deepEqual(preview.changes, []);
  assert.deepEqual(preview.conflicts, []);
  assert.equal(preview.status, 'preview');
  assert.deepEqual(preview.written, []);
  assert.deepEqual(preview.removed, []);
  assert.deepEqual(preview.backups, []);
  assert.ok(preview.planned.writes.length === 0);
  assert.ok(await fs.readFile(path.join(root, BASELINE_PATH), 'utf8'));
});

test('legacy files migrate only after old fingerprints verify ownership', async (t) => {
  const root = await fixture(t);
  const config = defaults();
  const rendered = await render(root, config);
  const manifest = {};
  for (const [file, content] of Object.entries(rendered)) {
    const block = `\n${content}\n`;
    manifest[file] = fingerprint(block);
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), `${BEGIN_MARKER}${block}${END_MARKER}\n`);
  }
  await writeJson(root, CONFIG_PATH, config);
  await writeJson(root, MANIFEST_PATH, manifest);
  const result = await generate(root, config);
  assert.deepEqual(result.conflicts, []);
  assert.ok(
    (
      await fs.readFile(path.join(root, '.agents/skills/my-skill-gweh/SKILL.md'), 'utf8')
    ).startsWith('---\n'),
  );
  assert.deepEqual((await generate(root, config, true)).changes, []);
});

test('flat documentation layout migrates into grouped paths without leaving old generated files', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  // Frozen output from the v0.1.3 renderer, built with PHP/Laravel selected and no source files.
  const releaseFiles = {
    [`${config.output}/quality.md`]: await fs.readFile(
      new URL('./legacy-v0.1.3-quality.md', import.meta.url),
      'utf8',
    ),
    [`${config.output}/project-context.md`]: await fs.readFile(
      new URL('./legacy-v0.1.3-project-context.md', import.meta.url),
      'utf8',
    ),
    [`${config.output}/workflow.md`]: await fs.readFile(
      new URL('./legacy-v0.1.3-workflow.md', import.meta.url),
      'utf8',
    ),
  };
  const manifest = {};
  for (const [file, body] of Object.entries(releaseFiles)) {
    const generated = replaceManagedContent(undefined, { body }, undefined);
    assert.ok(generated);
    manifest[file] = generated.fingerprint;
    const destination = path.join(root, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, generated.content);
  }
  await writeJson(root, CONFIG_PATH, config);
  await writeJson(root, MANIFEST_PATH, manifest);

  const result = await generate(root, config);
  assert.deepEqual(result.conflicts, []);
  assert.ok(result.removed.includes(`${config.output}/quality.md`));
  assert.ok(result.removed.includes(`${config.output}/project-context.md`));
  assert.ok(await fs.readFile(path.join(root, skillGuidePath(config.output, 'quality')), 'utf8'));
  assert.ok(await fs.readFile(path.join(root, projectGuidePath(config.output, 'context')), 'utf8'));
  await assert.rejects(fs.access(path.join(root, `${config.output}/quality.md`)));
  await assert.rejects(fs.access(path.join(root, `${config.output}/project-context.md`)));
  assert.deepEqual((await generate(root, config, true)).changes, []);
});

test('legacy release notes outside the managed block move into canonical docs and retain a backup', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  const file = `${config.output}/quality.md`;
  const body = await fs.readFile(new URL('./legacy-v0.1.3-quality.md', import.meta.url), 'utf8');
  const generated = replaceManagedContent(undefined, { body }, undefined);
  assert.ok(generated);
  const original = `${generated.content}\nCUSTOM PROJECT RULE: preserve audit event names.\n`;
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), original);
  await writeJson(root, CONFIG_PATH, config);
  await writeJson(root, MANIFEST_PATH, { [file]: generated.fingerprint });

  const result = await generate(root, config);
  assert.deepEqual(result.conflicts, []);
  assert.match(
    await fs.readFile(path.join(root, skillGuidePath(config.output, 'quality')), 'utf8'),
    /CUSTOM PROJECT RULE: preserve audit event names/u,
  );
  assert.ok(result.backups.some((backup) => backup.includes(`${file}`)));
  await assert.rejects(fs.access(path.join(root, file)));
  const repeated = await generate(root, config);
  assert.deepEqual(repeated.conflicts, []);
  assert.deepEqual(repeated.changes, []);
  assert.match(
    await fs.readFile(path.join(root, skillGuidePath(config.output, 'quality')), 'utf8'),
    /CUSTOM PROJECT RULE: preserve audit event names/u,
  );
});

test('flat-layout migration rebases developer-note links to the new guide location', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  const file = `${config.output}/quality.md`;
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'assets/manual.txt'), 'manual');
  const generated = replaceManagedContent(
    undefined,
    { body: '# Old quality guide\n\nLegacy content.' },
    undefined,
  );
  assert.ok(generated);
  const original = `${generated.content}\n\n[Manual](../assets/manual.txt)\n`;
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), original);
  await writeJson(root, CONFIG_PATH, config);
  await writeJson(root, MANIFEST_PATH, { [file]: generated.fingerprint });

  const result = await generate(root, config);
  assert.deepEqual(result.conflicts, []);
  const canonical = await fs.readFile(
    path.join(root, skillGuidePath(config.output, 'quality')),
    'utf8',
  );
  assert.match(canonical, /\]\(\.\.\/\.\.\/assets\/manual\.txt\)/u);
  assert.deepEqual((await doctor(root, config)).invalidReferences, []);
});

test('recovery ignores generator marker examples inside fenced and inline code', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'] };
  await fs.writeFile(
    path.join(root, 'README.md'),
    [
      '```md',
      BEGIN_MARKER,
      'Example managed content',
      END_MARKER,
      '```',
      '',
      `Inline: \`${BEGIN_MARKER}\` and \`${END_MARKER}\`.`,
    ].join('\n'),
  );
  const plan = await planGeneration(root, config);
  assert.ok(!plan.conflicts.includes('README.md'));
  assert.ok(!plan.recovered.includes('README.md'));
});

test('recovery does not scan or mutate generated files inside a nested repository', async (t) => {
  const root = await fixture(t);
  const child = path.join(root, 'apps', 'api');
  await fs.mkdir(path.join(child, '.git'), { recursive: true });
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  await generate(child, config);
  const nestedGuide = path.join(child, skillGuidePath(config.output, 'quality'));
  const before = await fs.readFile(nestedGuide, 'utf8');

  const result = await generate(root, config);
  assert.deepEqual(result.conflicts, []);
  assert.equal(await fs.readFile(nestedGuide, 'utf8'), before);
});

test('a parent manifest cannot remove files below a nested project boundary', async (t) => {
  const root = await fixture(t);
  const child = path.join(root, 'apps', 'api');
  await fs.mkdir(path.join(child, '.git'), { recursive: true });
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  await generate(child, config);
  const relativeGuide = skillGuidePath(config.output, 'quality');
  const childManifest = JSON.parse(await fs.readFile(path.join(child, MANIFEST_PATH), 'utf8'));
  const parentEntry = `apps/api/${relativeGuide}`;
  await writeJson(root, MANIFEST_PATH, { [parentEntry]: childManifest[relativeGuide] });
  const before = await fs.readFile(path.join(child, relativeGuide), 'utf8');

  const plan = await planGeneration(root, config);
  assert.ok(plan.conflicts.includes(parentEntry));
  assert.match(
    plan.conflictDetails.find(({ file }) => file === parentEntry)?.reason ?? '',
    /nested project/u,
  );
  const result = await commitGeneration(plan);
  assert.equal(result.status, 'blocked');
  assert.equal(await fs.readFile(path.join(child, relativeGuide), 'utf8'), before);
});

test('three-way merge retains independent canonical guide edits across repeated updates', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'], docsLanguage: 'en' };
  await generate(root, config);
  const file = path.join(root, skillGuidePath(config.output, 'quality'));
  const original = await fs.readFile(file, 'utf8');
  await fs.writeFile(
    file,
    original.replace(
      END_MARKER,
      '\n\nProject-specific rule: preserve audit event names.\n' + END_MARKER,
    ),
  );

  const translated = { ...config, docsLanguage: 'id' };
  const result = await generate(root, translated);
  assert.deepEqual(result.conflicts, []);
  assert.match(await fs.readFile(file, 'utf8'), /Jaga modul tetap terfokus/u);
  assert.match(
    await fs.readFile(file, 'utf8'),
    /Project-specific rule: preserve audit event names/u,
  );
  assert.ok(result.backups.length > 0);

  await generate(root, translated);
  assert.match(
    await fs.readFile(file, 'utf8'),
    /Project-specific rule: preserve audit event names/u,
  );
});

test('overlapping canonical guide edits require a decision and remain untouched', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'], docsLanguage: 'en' };
  await generate(root, config);
  const relative = skillGuidePath(config.output, 'quality');
  const file = path.join(root, relative);
  const original = (await fs.readFile(file, 'utf8')).replace(
    'Keep modules focused',
    'Keep my modules focused',
  );
  await fs.writeFile(file, original);
  const before = await snapshot(root);

  const plan = await planGeneration(root, { ...config, docsLanguage: 'id' });
  assert.ok(plan.conflicts.includes(relative));
  const result = await commitGeneration(plan);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(await snapshot(root), before);
});

test('per-hunk choices keep both edited and generated sections plus independent local edits', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'], docsLanguage: 'en' };
  await generate(root, config);
  const relative = skillGuidePath(config.output, 'quality');
  const file = path.join(root, relative);
  const original = (await fs.readFile(file, 'utf8'))
    .replace('Keep modules focused', 'Keep my modules focused')
    .replace(END_MARKER, '\n\nLocal-only operational note.\n' + END_MARKER);
  await fs.writeFile(file, original);

  const translated = { ...config, docsLanguage: 'id' };
  const conflictPlan = await planGeneration(root, translated);
  const conflict = conflictPlan.conflictDetails.find((item) => item.file === relative);
  assert.equal(conflict?.kind, 'merge');
  assert.ok(conflict?.merge?.hunks.length);
  const merge = conflict.merge;
  const choices = Object.fromEntries(merge.hunks.map((hunk) => [hunk.id, 'both']));
  const plan = await planGeneration(root, translated, {
    hunks: {
      [relative]: {
        baseFingerprint: merge.baseFingerprint,
        localFingerprint: merge.localFingerprint,
        generatedFingerprint: merge.generatedFingerprint,
        choices,
      },
    },
  });
  assert.deepEqual(plan.conflicts, []);
  await commitGeneration(plan);
  const updated = await fs.readFile(file, 'utf8');
  assert.match(updated, /Keep my modules focused/u);
  assert.match(updated, /Jaga modul tetap terfokus/u);
  assert.match(updated, /Local-only operational note/u);
});

test('configured output inside a nested project is blocked before any writes', async (t) => {
  const root = await fixture(t);
  const nested = path.join(root, 'apps/api');
  await fs.mkdir(path.join(nested, '.git'), { recursive: true });
  const before = await snapshot(root);
  const config = { ...defaults(), output: 'apps/api/ai-agent-docs' };
  const plan = await planGeneration(root, config);
  assert.equal(plan.conflictDetails[0]?.kind, 'nested');
  assert.match(plan.conflictDetails[0]?.reason ?? '', /run the CLI from that child project root/iu);
  assert.deepEqual(plan.changes, []);
  assert.equal((await commitGeneration(plan)).status, 'blocked');
  assert.deepEqual(await snapshot(root), before);
});

test('a nested project boundary added after planning blocks every write', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), output: 'apps/api/ai-agent-docs' };
  const plan = await planGeneration(root, config);
  await fs.mkdir(path.join(root, 'apps/api/.git'), { recursive: true });
  const before = await snapshot(root);
  await assert.rejects(commitGeneration(plan), /inside a nested project/u);
  assert.deepEqual(await snapshot(root), before);
});

test('edited deselected guides can be retained as plain docs with rebased links after revalidation', async (t) => {
  const root = await fixture(t);
  const initial = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  await generate(root, initial);
  const relative = skillGuidePath(initial.output, 'quality');
  const file = path.join(root, relative);
  const firstEdit = (await fs.readFile(file, 'utf8')).replace(
    END_MARKER,
    '\n\nDeveloper note: preserve this decision.\n' + END_MARKER,
  );
  await fs.writeFile(file, firstEdit);
  const next = { ...initial, skills: ['docs'] };
  const initialConflict = (await planGeneration(root, next)).conflictDetails.find(
    (item) => item.file === relative,
  );
  assert.equal(initialConflict?.reasonCode, 'modified-removal');

  const changedAfterPrompt = firstEdit.replace(
    'preserve this decision',
    'keep this updated decision',
  );
  await fs.writeFile(file, changedAfterPrompt);
  const staleDecision = await planGeneration(root, next, {
    resolutions: {
      [relative]: { action: 'retain', snapshot: fingerprint(firstEdit) },
    },
  });
  const refreshedConflict = staleDecision.conflictDetails.find((item) => item.file === relative);
  assert.ok(refreshedConflict);
  assert.equal(refreshedConflict.existing, changedAfterPrompt);
  assert.deepEqual(await fs.readFile(file, 'utf8'), changedAfterPrompt);

  const plan = await planGeneration(root, next, {
    resolutions: {
      [relative]: { action: 'retain', snapshot: fingerprint(changedAfterPrompt) },
    },
  });
  assert.deepEqual(plan.conflicts, []);
  const archive = plan.changes.find(({ file: candidate }) =>
    candidate.startsWith(`${initial.output}/retained/`),
  );
  assert.ok(archive);
  assert.ok(plan.removals.some(({ file: candidate }) => candidate === relative));
  await commitGeneration(plan);
  await assert.rejects(fs.access(file));
  assert.doesNotMatch(archive.content, /BEGIN my-skill-gweh|sha256:/u);
  assert.match(archive.content, /keep this updated decision/u);
  assert.match(archive.content, /\.\.\/\.\.\/project\/context\.md/u);
});

test('deleting a customized deselected guide stores its full original as a backup', async (t) => {
  const root = await fixture(t);
  const initial = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  await generate(root, initial);
  const relative = skillGuidePath(initial.output, 'quality');
  const file = path.join(root, relative);
  const original = (await fs.readFile(file, 'utf8')).replace(
    END_MARKER,
    '\n\nDeveloper note: remove only with backup.\n' + END_MARKER,
  );
  await fs.writeFile(file, original);
  const next = { ...initial, skills: ['docs'] };
  const blocked = await planGeneration(root, next);
  const conflict = blocked.conflictDetails.find((item) => item.file === relative);
  assert.ok(conflict);
  const plan = await planGeneration(root, next, {
    resolutions: {
      [relative]: { action: 'delete', snapshot: fingerprint(original) },
    },
  });
  assert.deepEqual(plan.conflicts, []);
  const result = await commitGeneration(plan);
  const backup = result.backups.find((candidate) => candidate.endsWith(`/${relative}`));
  assert.ok(backup);
  assert.equal(await fs.readFile(path.join(root, backup), 'utf8'), original);
  await assert.rejects(fs.access(file));
});

test('preview separates planned removals from operations actually applied', async (t) => {
  const root = await fixture(t);
  const initial = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  await generate(root, initial);
  const next = { ...initial, skills: ['docs'] };
  const preview = previewGeneration(await planGeneration(root, next));
  assert.ok(preview.planned.removals.includes(skillGuidePath(initial.output, 'quality')));
  assert.deepEqual(preview.removed, []);
  assert.deepEqual(preview.written, []);
  assert.deepEqual(preview.backups, []);
  const applied = await generate(root, next);
  assert.ok(applied.removed.includes(skillGuidePath(initial.output, 'quality')));
});

test('edited flat documentation blocks layout migration and remains untouched', async (t) => {
  const root = await fixture(t);
  const config = defaults();
  const rendered = await render(root, config);
  const oldFile = `${config.output}/quality.md`;
  const source = rendered[skillGuidePath(config.output, 'quality')];
  const generated = replaceManagedContent(undefined, { body: source }, undefined);
  assert.ok(generated);
  const edited = generated.content.replace(
    'Keep modules focused',
    'Keep my edited modules focused',
  );
  const destination = path.join(root, oldFile);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, edited);
  await writeJson(root, CONFIG_PATH, config);
  await writeJson(root, MANIFEST_PATH, { [oldFile]: generated.fingerprint });
  const before = await snapshot(root);

  const plan = await planGeneration(root, config);
  assert.ok(plan.conflicts.includes(oldFile));
  assert.equal(plan.conflictDetails.find(({ file }) => file === oldFile)?.kind, 'stale');
  const result = await generate(root, config);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(await snapshot(root), before);
});

test('recovers an exact legacy Cursor pointer when configuration and manifest are absent', async (t) => {
  const root = await fixture(t);
  const legacyConfig = { ...defaults(), output: 'docs', agents: ['cursor'] };
  const cursorFile = '.cursor/rules/my-skill-gweh.mdc';
  const header = '---\nalwaysApply: true\n---\n';
  const body = `Before editing, read the [engineering guidelines](${localLink(cursorFile, 'docs/README.md')}), [project context map](${localLink(cursorFile, 'docs/project-context.md')}), and [workflow](${localLink(cursorFile, 'docs/workflow.md')}). Then open the relevant skill guide linked from the index. Follow more specific repository instructions where they apply.`;
  const file = path.join(root, cursorFile);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${header}${BEGIN_MARKER}\n${body}\n${END_MARKER}\n`);

  const plan = await planGeneration(root, defaults());
  assert.deepEqual(plan.conflicts, []);
  assert.ok(plan.recovered.includes(cursorFile));
  await commitGeneration(plan);
  const updated = await fs.readFile(file, 'utf8');
  assert.match(updated, /my-skill-gweh-sha256:/u);
  assert.match(updated, /\.\.\/\.\.\/ai-agent-docs\/README\.md/u);
  assert.match(updated, /ask whether production may be reset/u);
  assert.match(updated, /ai-agent-docs\/project\/workflow\.md/u);
  assert.doesNotMatch(updated, /ai-agent-docs\/(?:project-context|workflow)\.md/u);
});

test('unverified orphan can be skipped while safe files are applied and reported as partial', async (t) => {
  const root = await fixture(t);
  const file = '.cursor/rules/my-skill-gweh.mdc';
  const content = `${BEGIN_MARKER}\nmanual or unknown content\n${END_MARKER}\n`;
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);

  const plan = await planGeneration(root, defaults(), { skip: [file] });
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.skipped, [file]);
  const result = await commitGeneration(plan);
  assert.equal(result.status, 'partial');
  assert.equal(await fs.readFile(path.join(root, file), 'utf8'), content);
  assert.ok(await fs.readFile(path.join(root, defaults().output, 'README.md'), 'utf8'));
});

test('deselected skills remove only verified managed outputs', async (t) => {
  const root = await fixture(t);
  const initial = { ...defaults(), agents: ['codex'] };
  await generate(root, initial);
  const next = { ...initial, skills: initial.skills.filter((skill) => skill !== 'contracts') };
  const plan = await planGeneration(root, next);
  assert.deepEqual(plan.conflicts, []);
  assert.ok(plan.removals.some(({ file }) => file === skillGuidePath(initial.output, 'contracts')));
  assert.ok(!plan.removals.some(({ file }) => file === '.agents/skills/my-skill-gweh/SKILL.md'));
  const result = await commitGeneration(plan);
  assert.equal(result.status, 'applied');
  assert.ok(result.removed.includes(skillGuidePath(initial.output, 'contracts')));
  await assert.rejects(fs.access(path.join(root, skillGuidePath(initial.output, 'contracts'))));
  const native = await fs.readFile(
    path.join(root, '.agents/skills/my-skill-gweh/SKILL.md'),
    'utf8',
  );
  assert.doesNotMatch(native, /^## contracts$/mu);
});

test('updates remove prior per-skill native files when their ownership is verified', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'] };
  await generate(root, config);
  const stale = '.agents/skills/my-skill-gweh-contracts/SKILL.md';
  const legacy = replaceManagedContent(
    undefined,
    {
      frontmatter:
        '---\nname: my-skill-gweh-contracts\ndescription: Legacy contracts skill.\n---\n',
      body: `# contracts\n\nFollow the project guide: [contracts](${localLink(stale, skillGuidePath(config.output, 'contracts'))})`,
    },
    undefined,
  );
  assert.ok(legacy);
  await fs.mkdir(path.dirname(path.join(root, stale)), { recursive: true });
  await fs.writeFile(path.join(root, stale), legacy.content);
  const manifest = JSON.parse(await fs.readFile(path.join(root, MANIFEST_PATH), 'utf8'));
  manifest[stale] = legacy.fingerprint;
  await writeJson(root, MANIFEST_PATH, manifest);

  const plan = await planGeneration(root, config);
  assert.deepEqual(plan.conflicts, []);
  assert.ok(plan.removals.some(({ file }) => file === stale));
  const result = await commitGeneration(plan);
  assert.equal(result.status, 'applied');
  await assert.rejects(fs.access(path.join(root, stale)));
  assert.ok(await fs.readFile(path.join(root, '.agents/skills/my-skill-gweh/SKILL.md'), 'utf8'));
});

test('edited obsolete native skill is preserved when skipped while other outputs update', async (t) => {
  const root = await fixture(t);
  const initial = { ...defaults(), agents: ['codex'] };
  await generate(root, initial);
  const stale = '.agents/skills/my-skill-gweh-contracts/SKILL.md';
  const stalePath = path.join(root, stale);
  const legacy = replaceManagedContent(
    undefined,
    {
      frontmatter:
        '---\nname: my-skill-gweh-contracts\ndescription: Legacy contracts skill.\n---\n',
      body: `# contracts\n\nFollow the project guide: [contracts](${localLink(stale, skillGuidePath(initial.output, 'contracts'))})`,
    },
    undefined,
  );
  assert.ok(legacy);
  await fs.mkdir(path.dirname(stalePath), { recursive: true });
  await fs.writeFile(stalePath, legacy.content);
  const manifest = JSON.parse(await fs.readFile(path.join(root, MANIFEST_PATH), 'utf8'));
  manifest[stale] = legacy.fingerprint;
  await writeJson(root, MANIFEST_PATH, manifest);
  const edited = (await fs.readFile(stalePath, 'utf8')).replace(
    'Follow the project guide:',
    'Follow my manual contract note and the project guide:',
  );
  await fs.writeFile(stalePath, edited);
  const next = {
    ...initial,
    docsLanguage: 'id',
    skills: initial.skills.filter((skill) => skill !== 'contracts'),
  };
  const blocked = await planGeneration(root, next);
  assert.ok(blocked.conflicts.includes(stale));
  const plan = await planGeneration(root, next, { skip: [stale] });
  assert.deepEqual(plan.conflicts, []);
  const result = await commitGeneration(plan);
  assert.equal(result.status, 'partial');
  assert.equal(await fs.readFile(stalePath, 'utf8'), edited);
  assert.match(
    await fs.readFile(path.join(root, skillGuidePath(initial.output, 'docs')), 'utf8'),
    /Sinkronkan/u,
  );
});

test('replacing an unowned target stores its original in the backup directory', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'] };
  const file = skillGuidePath(config.output, 'quality');
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), 'My existing file');
  const blocked = await planGeneration(root, config);
  assert.ok(blocked.conflicts.includes(file));
  const plan = await planGeneration(root, config, { replace: [file] });
  assert.deepEqual(plan.conflicts, []);
  const result = await commitGeneration(plan);
  assert.equal(result.status, 'applied');
  const backup = Object.keys(await snapshot(root)).find((name) => name.includes('/quality.md'));
  assert.ok(backup?.startsWith('.my-skill-gweh/backups/'));
  assert.equal((await snapshot(root))[backup], 'My existing file');
});

test('CRLF managed content verifies and replacements retain its line endings and manual text', () => {
  const document = { body: '# First generated body\n' };
  const first = replaceManagedContent(undefined, document, undefined);
  const crlf = `# Manual text\r\n\r\n${first.content.replaceAll('\n', '\r\n')}`;
  const updated = replaceManagedContent(crlf, { body: '# Updated body\n' }, first.fingerprint);
  assert.ok(updated);
  assert.ok(updated.content.startsWith('# Manual text\r\n\r\n'));
  assert.match(updated.content, /# Updated body/u);
  assert.doesNotMatch(updated.content, /(?<!\r)\n/u);
  assert.equal(fingerprint('same\r\ntext'), fingerprint('same\ntext'));
});

test('changed metadata is a conflict, even if the Markdown body is untouched', async (t) => {
  const root = await fixture(t);
  const config = defaults();
  await generate(root, config);
  const file = '.agents/skills/my-skill-gweh/SKILL.md';
  const location = path.join(root, file);
  await fs.writeFile(
    location,
    (await fs.readFile(location, 'utf8')).replace('name: my-skill-gweh', 'name: changed'),
  );
  const before = await snapshot(root);
  const result = await generate(root, { ...config, docsLanguage: 'id' });
  assert.ok(result.conflicts.includes(file));
  assert.deepEqual(await snapshot(root), before);
});

test('forced canonical replacement preserves developer YAML frontmatter and signs it', () => {
  const initial = replaceManagedContent(undefined, { body: 'Original generated text' }, undefined);
  assert.ok(initial);
  const original = `---\nowner: Alfian57\nreview: required\n---\n${initial.content}`;
  const replacement = replaceManagedContent(
    original,
    { body: 'Updated generated text' },
    undefined,
    { force: true },
  );
  assert.ok(replacement);
  assert.ok(replacement.content.startsWith('---\nowner: Alfian57\nreview: required\n---\n'));
  assert.match(replacement.content, /Updated generated text/u);
  assert.equal(managedContentFingerprint(replacement.content), replacement.fingerprint);
});

for (const mutation of [
  (text) => text.replace(END_MARKER, ''),
  (text) => text + `\n${BEGIN_MARKER}\n${END_MARKER}\n`,
  (text) => text.replace(BEGIN_MARKER, ''),
]) {
  test('malformed or duplicated ownership markers abort the entire generation', async (t) => {
    const root = await fixture(t);
    const config = defaults();
    await generate(root, config);
    const file = path.join(root, 'AGENTS.md');
    await fs.writeFile(file, mutation(await fs.readFile(file, 'utf8')));
    const before = await snapshot(root);
    assert.ok(
      (await generate(root, { ...config, docsLanguage: 'id' })).conflicts.includes('AGENTS.md'),
    );
    assert.deepEqual(await snapshot(root), before);
  });
}

test('empty unowned files are not overwritten', async (t) => {
  const root = await fixture(t);
  const config = defaults();
  const target = skillGuidePath(config.output, 'quality');
  await fs.mkdir(path.dirname(path.join(root, target)), { recursive: true });
  await fs.writeFile(path.join(root, target), '');
  const before = await snapshot(root);
  assert.ok(
    (await generate(root, config)).conflicts.includes(skillGuidePath(config.output, 'quality')),
  );
  assert.deepEqual(await snapshot(root), before);
});

test('output filename collisions fail before creating metadata or documentation', async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    generate(root, { ...defaults(), output: 'AGENTS.md/docs' }),
    /conflicts with directory/,
  );
  assert.deepEqual(await fs.readdir(root), []);
});

test('symlinked output and metadata cannot write outside the target', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  const link = path.join(root, defaults().output);
  await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(generate(root, defaults()), /symlink/);
  assert.deepEqual(await fs.readdir(outside), []);
  await fs.unlink(link);
  await fs.symlink(
    outside,
    path.join(root, '.my-skill-gweh'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(generate(root, defaults()), /symlink/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('corrupt manifests are rejected before writes', async (t) => {
  const root = await fixture(t);
  for (const value of [null, [], { 'AGENTS.md': 'not-a-hash' }, { '../outside': 'a'.repeat(64) }]) {
    await writeJson(root, MANIFEST_PATH, value);
    const before = await snapshot(root);
    await assert.rejects(generate(root, defaults()));
    assert.deepEqual(await snapshot(root), before);
  }
});

test('changes made between preview and commit are preserved', async (t) => {
  const root = await fixture(t);
  const plan = await planGeneration(root, defaults());
  await fs.writeFile(path.join(root, 'AGENTS.md'), 'Changed after preview');
  await assert.rejects(commitGeneration(plan), /changed since preview/);
  assert.equal(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), 'Changed after preview');
  assert.deepEqual(await fs.readdir(root), ['AGENTS.md']);
});

test('doctor handles encoded links, reports missing references, and never writes', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), output: 'team docs/engineering (#1)' };
  await generate(root, config);
  assert.ok(isHealthy(await doctor(root, config)));
  const file = path.join(root, skillGuidePath(config.output, 'quality'));
  await fs.unlink(file);
  const before = await snapshot(root);
  const result = await doctor(root, config);
  assert.ok(result.missing.includes(skillGuidePath(config.output, 'quality')));
  assert.ok(result.invalidReferences.some((item) => item.target === 'engineering/quality.md'));
  assert.deepEqual(await snapshot(root), before);
});

test('doctor marks missing or drifting ownership baselines as unhealthy state', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  await generate(root, config);
  await fs.unlink(path.join(root, BASELINE_PATH));

  const report = await doctor(root, config);
  assert.equal(report.state, 'orphaned');
  assert.ok(report.missing.includes(BASELINE_PATH));
  assert.ok(report.drift.includes(BASELINE_PATH));
  assert.match(report.diagnostics.join('\n'), /baselines are missing/u);
  assert.equal(isHealthy(report), false);
});

test('doctor rejects a corrupt baseline file without writing repairs', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  await generate(root, config);
  await fs.writeFile(path.join(root, BASELINE_PATH), '{not json');
  const before = await snapshot(root);

  const report = await doctor(root, config);
  assert.equal(report.state, 'invalid');
  assert.match(report.diagnostics.join('\n'), /baselines|JSON|parse/u);
  assert.deepEqual(await snapshot(root), before);
  assert.equal(isHealthy(report), false);
});

test('doctor ignores code examples and accepts local directory links', async (t) => {
  const root = await fixture(t);
  const config = { ...defaults(), agents: ['codex'], skills: ['quality'] };
  await generate(root, config);
  const file = path.join(root, skillGuidePath(config.output, 'quality'));
  await fs.appendFile(
    file,
    '\n[Project directory](../project/)\n\n```md\n[example](missing-code.md)\n```\n`[inline](missing-inline.md)`\n',
  );
  const report = await doctor(root, config);
  assert.deepEqual(report.invalidReferences, []);
  assert.equal(report.lock.state, 'none');
});

test('case-only file/directory collisions are rejected consistently across platforms', async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    generate(root, { ...defaults(), output: 'agents.md/docs' }),
    /conflicts with directory/,
  );
  assert.deepEqual(await fs.readdir(root), []);
});
