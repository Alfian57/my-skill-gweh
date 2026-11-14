# Instructions for coding agents

- Read the relevant source and tests before changing behavior. Keep changes focused and cover user-visible behavior with automated tests.
- Use conventional commit messages when preparing commits; they drive automated versioning and changelog generation.
- For release setup, release steps, or failed-publication recovery, follow [`docs/releasing.md`](docs/releasing.md).
- Do not bump package versions with `npm version`, create/push release tags manually, or publish from a developer machine. Release Please owns version updates and GitHub Actions publishes through npm Trusted Publishing.
- Keep `.github/workflows/publish.yml` as the workflow filename because npm Trusted Publisher is configured against it.
- Use Conventional Commit pull request titles and squash-and-merge only; after merge, verify the worktree and PR head before deleting a local feature branch. GitHub auto-deletes merged remote branches.
