import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { defaults, CONFIG_PATH, MANIFEST_PATH } from '../dist/config.js';
import { generate, planGeneration, commitGeneration } from '../dist/generator.js';
import { fingerprint, BEGIN_MARKER, END_MARKER } from '../dist/managed-content.js';
import { render } from '../dist/render.js';
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
  assert.ok(metadataFiles.length > 10);
  for (const file of metadataFiles) {
    assert.ok(files[file].startsWith('---\n'), file);
    assert.ok(files[file].indexOf('\n---\n') < files[file].indexOf(BEGIN_MARKER), file);
  }
  assert.deepEqual(await generate(root, defaults(), true), { changes: [], conflicts: [] });
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
      await fs.readFile(path.join(root, '.agents/skills/my-skill-gweh-quality/SKILL.md'), 'utf8')
    ).startsWith('---\n'),
  );
  assert.deepEqual((await generate(root, config, true)).changes, []);
});

test('changed metadata is a conflict, even if the Markdown body is untouched', async (t) => {
  const root = await fixture(t);
  const config = defaults();
  await generate(root, config);
  const file = '.agents/skills/my-skill-gweh-quality/SKILL.md';
  const location = path.join(root, file);
  await fs.writeFile(
    location,
    (await fs.readFile(location, 'utf8')).replace('name: my-skill-gweh-quality', 'name: changed'),
  );
  const before = await snapshot(root);
  const result = await generate(root, { ...config, docsLanguage: 'id' });
  assert.ok(result.conflicts.includes(file));
  assert.deepEqual(await snapshot(root), before);
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
  await fs.mkdir(path.join(root, config.output));
  await fs.writeFile(path.join(root, config.output, 'quality.md'), '');
  const before = await snapshot(root);
  assert.ok((await generate(root, config)).conflicts.includes(`${config.output}/quality.md`));
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
  const file = path.join(root, config.output, 'quality.md');
  await fs.unlink(file);
  const before = await snapshot(root);
  const result = await doctor(root, config);
  assert.ok(result.missing.includes(`${config.output}/quality.md`));
  assert.ok(result.invalidReferences.some((item) => item.target === 'quality.md'));
  assert.deepEqual(await snapshot(root), before);
});

test('case-only file/directory collisions are rejected consistently across platforms', async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    generate(root, { ...defaults(), output: 'agents.md/docs' }),
    /conflicts with directory/,
  );
  assert.deepEqual(await fs.readdir(root), []);
});
