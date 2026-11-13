import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { releaseInfo } from '../scripts/release-info.mjs';

const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const source = {
  tag: `v${metadata.version}`,
  refType: 'tag',
  repository: 'Alfian57/my-skill-gweh',
};

test('stable release uses latest only for the exact configured repository and version tag', () => {
  assert.deepEqual(releaseInfo(metadata, source), { version: metadata.version, distTag: 'latest' });
});

test('prerelease publication does not replace latest', () => {
  const beta = { ...metadata, version: '0.2.0-beta.1' };
  assert.equal(releaseInfo(beta, { ...source, tag: 'v0.2.0-beta.1' }).distTag, 'next');
});

for (const [label, override] of [
  ['a branch', { refType: 'branch' }],
  ['a version mismatch', { tag: 'v9.9.9' }],
  ['a fork', { repository: 'SomeoneElse/my-skill-gweh' }],
]) {
  test(`release guard rejects ${label}`, () => {
    assert.throws(() => releaseInfo(metadata, { ...source, ...override }));
  });
}

for (const [label, override] of [
  ['wrong package name', { name: 'another-package' }],
  ['wrong registry', { publishConfig: { access: 'public', registry: 'https://example.com' } }],
  [
    'private access',
    { publishConfig: { access: 'restricted', registry: 'https://registry.npmjs.org/' } },
  ],
  ['invalid version', { version: '01.0.0' }],
  ['empty prerelease segment', { version: '0.1.0-beta..1' }],
  ['leading zero in prerelease', { version: '0.1.0-beta.01' }],
]) {
  test(`release guard rejects ${label}`, () => {
    assert.throws(() =>
      releaseInfo(
        { ...metadata, ...override },
        {
          ...source,
          tag: `v${override.version ?? metadata.version}`,
        },
      ),
    );
  });
}

test('an unpublished version needs publication', async () => {
  const { publicationNeeded } = await import('../scripts/publication-state.mjs');
  assert.equal(publicationNeeded(Buffer.from('release archive'), undefined), true);
});

test('publication retries skip only an identical immutable tarball', async () => {
  const { createHash } = await import('node:crypto');
  const { publicationNeeded } = await import('../scripts/publication-state.mjs');
  const bytes = Buffer.from('release archive');
  const existing = {
    dist: { integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` },
  };
  assert.equal(publicationNeeded(bytes, existing), false);
  assert.throws(
    () => publicationNeeded(Buffer.from('changed archive'), existing),
    /different tarball/,
  );
  assert.throws(() => publicationNeeded(bytes, {}), /different tarball/);
});
