# My Skill Gweh

A local bilingual engineering documentation and native skill generator for Node.js 22+.

```sh
npm install -g my-skill-gweh
my-skill-gweh init

# Without a global installation
npx my-skill-gweh init
```

Run the wizard inside the application directory. It detects manifest dependencies, shows declared project scripts without executing them, and lets you review the stack and select rules. CLI and documentation languages can be chosen independently: Indonesian or English.

## Commands

```sh
my-skill-gweh init [path]
my-skill-gweh update [path]
my-skill-gweh update [path] --reconfigure
my-skill-gweh doctor [path] --json
my-skill-gweh list --json
my-skill-gweh preset save personal
my-skill-gweh preset list
my-skill-gweh preset show personal
my-skill-gweh preset remove personal
```

`init` requires a project that has not been initialized. `update` uses its saved configuration; `--config file.json` explicitly supplies replacement choices. `--reconfigure` opens the wizard again. Run `--help` for all flags.

For scripts, provide the full configuration:

```json
{
  "version": 1,
  "language": "id",
  "docsLanguage": "en",
  "output": "ai-agent-docs",
  "agents": ["codex", "claude"],
  "skills": ["quality", "docs", "contracts", "testing"],
  "validation": "ask",
  "git": "existing",
  "stack": ["typescript", "react", "nextjs"]
}
```

```sh
my-skill-gweh init ./application --config choices.json --non-interactive --dry-run --json
my-skill-gweh init ./application --config choices.json --non-interactive --json
my-skill-gweh update ./application --non-interactive --json
```

`--dry-run` lists changes without writing anything. In an interactive terminal it still asks configuration questions. `--json` with init/update requires `--non-interactive` and emits a single JSON report. Conflicts exit with status 1, including during dry-run. Cancellation exits with status 130. Invalid arguments and unsupported flag combinations fail before any writes.

The `output` folder is relative to the project and uses `/` separators on all platforms. Traversal and reserved metadata directories are rejected. Folder names containing spaces, Unicode, `#`, or parentheses are supported, with encoded Markdown references.

## Generated files and updates

Documentation defaults to `ai-agent-docs`. The generator creates engineering rules and workflow guidance, not inferred business roles or application architecture.

| Agent          | Project instructions              | Native skills      |
| -------------- | --------------------------------- | ------------------ |
| Codex          | `AGENTS.md`                       | `.agents/skills`   |
| Claude Code    | `CLAUDE.md`                       | `.claude/skills`   |
| Gemini CLI     | `GEMINI.md`                       | `.agents/skills`   |
| Cursor         | `AGENTS.md`, `.cursor/rules`      | `.agents/skills`   |
| OpenCode       | `AGENTS.md`                       | `.agents/skills`   |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/skills`   |
| Windsurf       | `AGENTS.md`, `.windsurf/rules`    | `.windsurf/skills` |
| Antigravity    | `AGENTS.md`                       | `.agents/skills`   |

Agent version and organization policies may affect discovery. Reload or restart the agent after generation if necessary. No global agent settings are changed, and installation does not run a hook that modifies project files.

Configuration lives in `.my-skill-gweh/config.json`; ownership fingerprints live in `.my-skill-gweh/manifest.json`. Commit both alongside generated files. Generated YAML frontmatter stays at the beginning of native skill and rule files. Its fingerprint protects it together with the managed body.

Existing plain instruction files receive a marked block. Text outside that block is preserved exactly on update. Existing unowned generated-target files, edited managed content or metadata, missing markers, and duplicate markers are conflicts. A conflict aborts the entire write operation. Resolve it manually before retrying. Verified output from the original generator is migrated to the corrected frontmatter format automatically.

Every destination, including metadata, is checked for symlinks and file/directory collisions before writing. A project lock prevents simultaneous generator writes. Files are replaced individually using temporary files; ordinary write failures trigger rollback. This is not a crash-atomic filesystem transaction: if a process is interrupted, inspect the project before removing a stale `.my-skill-gweh.lock` and retrying.

`doctor` reads saved configuration, checks expected files and ownership fingerprints, and verifies local Markdown file references. It never runs project tests/builds or claims that an agent loaded the skill. Missing files, conflicts, drift, or invalid references produce status 1.

## Presets

`preset save NAME` snapshots the current project's validated configuration without overwriting an existing preset. `--config choices.json` chooses a different source. Names use lowercase letters, digits and hyphens.

Presets live under `$XDG_CONFIG_HOME/my-skill-gweh/presets`, or the platform's user configuration directory when it is unset. Read-only commands do not create this directory. `preset show NAME` prints reusable JSON; save that output to a file and pass it to `init --config`.

## Development

```sh
npm ci
npm run check
npm test
npm run package
npm run test:package -- artifacts/my-skill-gweh-0.1.1.tgz
```

`npm run format` applies Prettier. `check` verifies formatting and strict TypeScript types. Tests use isolated temporary projects and user configuration paths. CI checks Linux, macOS and Windows on Node.js 22 and 24.

Source responsibilities:

- `src/cli/`: argument validation, command orchestration, output and injectable wizard I/O.
- Configuration, catalog, detection and rendering modules: validated choices and deterministic document content.
- Managed-content, generator, filesystem and transaction modules: ownership, preview planning and protected writes.
- Doctor and preset modules: diagnostics and saved user choices.
- `src/core.ts`: compatibility exports for the original module entrypoint.

## Build and npm publishing

`npm run package` produces an installable tarball and SHA-256 checksum in `artifacts/`. Each build removes the previous `dist/` directory so deleted source modules cannot remain in a release. `npm run test:package -- path/to/package.tgz` installs that exact tarball in a temporary directory and exercises the CLI without source files or devDependencies.

The npm CD workflow runs on version tags (`v0.1.1`, for example). It validates the version and repository, reuses the six-platform CI checks, tests the release tarball, uploads it with its checksum, and publishes it through npm Trusted Publishing (OIDC). Stable versions use `latest`; prereleases use `next`.

See [the release guide](docs/releasing.md) for initial npm setup, Trusted Publisher settings and subsequent releases. The workflow does not need an `NPM_TOKEN` secret.

## Current limitations

Custom template/skill imports, multi-application discovery, stack-specific recommendations, interactive conflict resolution/backups, obsolete-output deletion and a preset picker in the wizard are not implemented yet. Run init separately inside each application. Update preserves obsolete generated files rather than deleting them automatically.

No API key or network connection is required at runtime. Generated test and Git policies describe agent behavior; running this CLI does not execute those project actions.
