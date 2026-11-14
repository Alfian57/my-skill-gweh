import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { releaseInfo } from '../scripts/release-info.mjs';
import { verifyPublishedVersion } from '../scripts/verify-publication.mjs';

const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const releaseConfig = JSON.parse(
  await readFile(new URL('../.release-please-config.json', import.meta.url), 'utf8'),
);
const releaseManifest = JSON.parse(
  await readFile(new URL('../.release-please-manifest.json', import.meta.url), 'utf8'),
);
const source = {
  tag: `v${metadata.version}`,
  refType: 'tag',
  repository: 'Alfian57/my-skill-gweh',
};

test('Release Please configuration matches the package and current manifest baseline', () => {
  assert.equal(releaseConfig['release-type'], 'node');
  assert.equal(releaseConfig.packages['.']['package-name'], metadata.name);
  assert.equal(releaseManifest['.'], metadata.version);
});

test('local npm version and release scripts are removed', () => {
  assert.equal(
    Object.keys(metadata.scripts).some((script) => script.startsWith('release:')),
    false,
  );
  assert.equal(metadata.scripts.preversion, undefined);
  assert.equal(metadata.scripts.version, undefined);
});

test('release workflow runs on main pushes and manual recovery, not tag pushes', async () => {
  const workflow = (
    await readFile(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
  ).replace(/\r\n/gu, '\n');
  assert.match(workflow, /push:\n\s+branches: \[main\]/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /tags:\s*\['v\*'\]/u);
  assert.match(workflow, /actions\/create-github-app-token@/u);
  assert.match(workflow, /googleapis\/release-please-action@/u);
  assert.match(workflow, /Check Release Please App configuration/u);
  assert.match(workflow, /RELEASE_PLEASE_APP_PRIVATE_KEY/u);
  assert.match(workflow, /npm publish .*--provenance/u);
});

test('CI exposes a required gate for pull requests and reusable recovery checks', async () => {
  const workflow = (
    await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  ).replace(/\r\n/gu, '\n');
  assert.match(workflow, /pull_request:\n\s+branches: \[main\]/u);
  assert.match(workflow, /workflow_call:/u);
  assert.match(workflow, /name: CI gate/u);
  assert.match(workflow, /name: Installable package smoke test/u);
});

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

test('post-publish verification retries 404 and transient errors until exact integrity appears', async () => {
  const { createHash } = await import('node:crypto');
  const bytes = Buffer.from('verified package');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  let now = 0;
  let calls = 0;
  const result = await verifyPublishedVersion({
    name: metadata.name,
    version: metadata.version,
    tarball: bytes,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 404 };
      if (calls === 2) return { ok: false, status: 503 };
      return {
        ok: true,
        status: 200,
        json: async () => ({ version: metadata.version, dist: { integrity } }),
      };
    },
    sleepImpl: async (milliseconds) => {
      now += milliseconds;
    },
    nowImpl: () => now,
    timeoutMs: 100,
    pollIntervalMs: 10,
  });
  assert.equal(calls, 3);
  assert.deepEqual(result, { name: metadata.name, version: metadata.version, integrity });
});

test('post-publish verification rejects wrong immutable bytes and non-retryable registry errors', async () => {
  const { createHash } = await import('node:crypto');
  const bytes = Buffer.from('expected package');
  const wrong = Buffer.from('different package');
  const wrongIntegrity = `sha512-${createHash('sha512').update(wrong).digest('base64')}`;
  await assert.rejects(
    verifyPublishedVersion({
      name: metadata.name,
      version: metadata.version,
      tarball: bytes,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ version: metadata.version, dist: { integrity: wrongIntegrity } }),
      }),
    }),
    /different tarball/u,
  );
  await assert.rejects(
    verifyPublishedVersion({
      name: metadata.name,
      version: metadata.version,
      tarball: bytes,
      fetchImpl: async () => ({ ok: false, status: 403 }),
    }),
    /HTTP 403/u,
  );
});

test('post-publish verification stops after its bounded wait', async () => {
  let now = 0;
  await assert.rejects(
    verifyPublishedVersion({
      name: metadata.name,
      version: metadata.version,
      tarball: Buffer.from('expected package'),
      fetchImpl: async () => ({ ok: false, status: 404 }),
      sleepImpl: async (milliseconds) => {
        now += milliseconds;
      },
      nowImpl: () => now,
      timeoutMs: 25,
      pollIntervalMs: 10,
    }),
    /within 25 ms/u,
  );
});
