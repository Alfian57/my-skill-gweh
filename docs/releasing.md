# Release workflow

This repository publishes `my-skill-gweh` from GitHub Actions. Release Please determines the next version from conventional commits, updates `package.json`, `package-lock.json` and `CHANGELOG.md` in a release PR, and creates the GitHub Release after that PR is merged. The workflow then publishes the verified tarball to npm with OIDC provenance.

## One-time GitHub setup

Create one GitHub App for Release Please and install it on this repository (the same App can serve other package repositories). Grant these repository permissions:

| Permission    | Access         |
| ------------- | -------------- |
| Contents      | Read and write |
| Issues        | Read and write |
| Pull requests | Read and write |

In this repository's **Settings → Secrets and variables → Actions**, add:

| Kind     | Name                             | Value                        |
| -------- | -------------------------------- | ---------------------------- |
| Variable | `RELEASE_PLEASE_APP_ID`          | The GitHub App ID            |
| Secret   | `RELEASE_PLEASE_APP_PRIVATE_KEY` | The private key for that App |

The App token is used so that a Release Please PR triggers normal CI. Do not put its private key in the repository or a prompt.

Add these settings separately to every repository using the App; the App ID and private key can be reused. Protect `main` so changes must come through a pull request and require the GitHub Actions check **CI gate**. Allow **squash and merge only**, use the pull request title as the squash commit title, and enable automatic deletion of merged branches. Conventional pull request titles then remain visible to Release Please. Do not require an approval count that would prevent the sole maintainer from merging. The workflow is ready to publish only after the App is installed and both Actions values exist in this repository.

## One-time npm setup

In npm package settings, configure a GitHub Actions Trusted Publisher:

| Setting              | Value                      |
| -------------------- | -------------------------- |
| Organization or user | `Alfian57`                 |
| Repository           | `my-skill-gweh`            |
| Workflow filename    | `publish.yml`              |
| Environment          | Leave empty                |
| Publishing mode      | Allow direct `npm publish` |

The workflow uses Node.js 24, npm 11.16.0 and `id-token: write`. Do not add an `NPM_TOKEN`; npm credentials are provided through OIDC. Keep the workflow filename `publish.yml` aligned with this Trusted Publisher configuration.

## Releasing a change

1. Make changes on a feature branch and use [Conventional Commits](https://www.conventionalcommits.org/), for example `fix: handle empty project config` or `feat: add mascot skill`.
2. Open a pull request to `main`. The required **CI gate** runs static checks, the Node 22/24 Linux, macOS and Windows test matrix, and an installable tarball smoke test.
3. Merge the change after CI passes. A push to `main` runs Release Please, which opens or updates the release PR when the commit history contains releasable changes.
4. Review the version bump and generated changelog in the release PR. Its **CI gate** must pass before merging.
5. Merge the release PR. Release Please creates the version tag and GitHub Release; the same main-branch workflow validates the release and publishes the package.
6. Confirm the `Release and publish npm package` run succeeds and npm has the expected version:

   ```sh
   npm view my-skill-gweh version
   npm install -g my-skill-gweh@latest
   my-skill-gweh --version
   ```

After confirming a feature PR is merged, update local `main` with `git pull --ff-only`. Check the worktree is clean and compare the local feature branch's commit with the merged PR's `headRefOid` before removing that local branch. Squash commits do not preserve feature-branch ancestry, so a verified merged branch may require `git branch -D`. GitHub deletes its remote branch automatically through the repository setting.

Prerelease versions use the `next` npm dist-tag. The workflow builds one tarball, smoke-tests that archive, publishes those exact bytes, and checks the registry's SHA-512 integrity. An existing npm version is skipped only when its tarball is identical; a mismatch fails rather than overwriting the immutable version.

## Recovering a failed publication

First resolve the cause, such as an npm Trusted Publisher mismatch or registry outage. For code or validation fixes, dispatch `publish.yml` from `main` and pass the existing Release Please tag. The workflow validates using its current guard and loads package metadata and release contents from the selected tag:

```sh
gh workflow run publish.yml --repo Alfian57/my-skill-gweh --ref main -f release_tag=my-skill-gweh-v0.2.0
```

The retry validates the tag against the package metadata at that tag, reruns CI, and applies the same exact-tarball check. A branch ref or mismatched tag is rejected. Never move a release tag, bump a version with `npm version`, or run `npm publish` locally.
