# Building and releasing My Skill Gweh

The package is `my-skill-gweh`, sourced from `https://github.com/Alfian57/my-skill-gweh`. The configured workflow is `.github/workflows/publish.yml`. This document describes preparation; running local build commands does not publish anything.

## Build a package locally

```sh
npm ci
npm run check
npm test
npm run package
npm run test:package -- artifacts/my-skill-gweh-0.1.2.tgz
```

Replace the version in the filename after a version bump. `artifacts/` contains the `.tgz` and its `.tgz.sha256` checksum. Generated JavaScript, README, package metadata and the MIT license are included. Source, tests, development scripts and configuration are excluded.

Install the tarball locally to try the command before npm publication:

```sh
npm install -g ./artifacts/my-skill-gweh-0.1.2.tgz
my-skill-gweh --version
```

## One-time GitHub setup

Create the public GitHub repository `Alfian57/my-skill-gweh` and push this source, including `package-lock.json` and `.github/workflows/`. The repository URL must match `package.json` exactly for provenance. If this directory is not a Git repository yet, initialize it and review the files intended for the first commit before pushing.

Both workflows use GitHub-hosted runners. CI runs on pushes and pull requests, and is also reusable by the publication workflow. The publication workflow requires all six combinations of Node.js 22/24 and Linux/macOS/Windows to pass.

## One-time npm bootstrap

A new package must exist before its Trusted Publisher can be configured. The initial `0.1.1` package is therefore published interactively by its maintainer:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public
```

Run these commands from the prepared source checkout. `prepublishOnly` runs format/type checks and tests; `prepack` performs a clean build. Complete any browser authentication or 2FA challenge on your machine. Credentials do not belong in this repository or a chat message.

The initial manual publication does not carry GitHub Actions provenance. Subsequent OIDC releases carry provenance. A subsequent `v0.1.1` workflow run verifies the published tarball integrity and skips publication only if the archive is identical. npm versions cannot be overwritten.

## Configure Trusted Publishing

In the npm package settings, add a GitHub Actions Trusted Publisher with these exact values:

| Setting              | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| Organization or user | `Alfian57`                                             |
| Repository           | `my-skill-gweh`                                        |
| Workflow filename    | `publish.yml`                                          |
| Environment name     | Leave empty; this workflow does not set an environment |
| Allowed actions      | Enable direct `npm publish`                            |

No `NPM_TOKEN` secret is required. The publishing job uses Node.js 24, npm 11.16.0 and `id-token: write`. npm requires Node.js 22.14+ and npm 11.5.1+ for OIDC. New publisher configurations may permit staged publishing by default; explicitly allow direct publishing because this workflow uses `npm publish`.

References: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/), [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/), [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

## Subsequent releases

Start from the intended release commit with a clean Git working tree and configured maintainer identity:

```sh
# Validates the current source, bumps package.json/package-lock.json,
# and creates the version commit and Git tag. It does not push.
npm run release:patch

# For the first automated release after the manual 0.1.1 bootstrap:
git push origin main
git push origin v0.1.2
```

Use `release:minor` or `release:major` for other semantic version changes. Substitute the actual resulting tag in the push command. Pushing the tag starts publication; simply committing or pushing a branch does not publish to npm.

The workflow:

1. Requires a tag exactly matching `v` plus the package version, and verifies the configured source repository.
2. Runs the reusable CI matrix, including an installed-tarball smoke test.
3. Builds and installs the release tarball in the publishing job, then verifies `--version`, `init`, idempotent `update`, `doctor`, and native skill frontmatter.
4. Uploads the tested tarball and checksum as a workflow artifact for 30 days.
5. Publishes that exact tarball with OIDC and provenance, without rebuilding during publication. Stable versions use `latest`; prerelease versions such as `0.2.0-beta.1` use `next`.
6. Polls the npm registry for up to five minutes and verifies that the published version exposes the same integrity digest as the tested tarball. Temporary registry propagation errors are retried; a digest mismatch or non-retryable registry error fails the workflow.

After the workflow succeeds, confirm the publication and install it locally:

```sh
npm view my-skill-gweh version
npm install -g my-skill-gweh@latest
my-skill-gweh --version
```

For prereleases, inspect or install `my-skill-gweh@next`. Registry propagation can lag behind a successful publication.

## Retrying a failed release

Fix authentication or publisher settings and rerun the failed workflow. Manual dispatch also works when explicitly targeting the existing release tag:

```sh
gh workflow run publish.yml --ref v0.1.2
```

Dispatch from a branch is rejected by the release guard. If a version has already reached npm, an identical tarball is verified and publication is skipped; a different tarball fails explicitly. Do not overwrite published versions or move Git tags. Prepare a new version for code changes. A failure before the publish step does not publish anything; uploaded artifacts alone are not a release.
