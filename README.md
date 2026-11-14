# My Skill Gweh

A local bilingual engineering documentation and native skill generator for Node.js 22+.

```sh
npm install -g my-skill-gweh
my-skill-gweh init

# Without a global installation
npx my-skill-gweh init
```

Run the wizard inside the application directory. It detects source languages and manifest dependencies, shows declared project scripts without executing them, and lets you review the stack with grouped checkboxes. CLI and documentation languages can be chosen independently: Indonesian or English.

## Commands

```sh
my-skill-gweh init [path]
my-skill-gweh update [path]
my-skill-gweh update [path] --reconfigure
my-skill-gweh skill enable mascot [path]
my-skill-gweh skill disable mascot [path]
my-skill-gweh doctor [path] --json
my-skill-gweh list --json
my-skill-gweh --version --verbose
my-skill-gweh preset save personal
my-skill-gweh preset list
my-skill-gweh preset show personal
my-skill-gweh preset remove personal
```

`init` requires a project that has not been initialized. `update` uses its saved configuration; `--config file.json` explicitly supplies replacement choices. `--reconfigure` opens the wizard again. `skill enable|disable ID` changes one skill and uses the same preview, confirmation, and conflict flow as update. A plain update reports optional skills added since the project last reviewed the catalog, without enabling them. `--version --verbose` shows the running module path; plain `--version` remains the package version. Run `--help` for all flags.

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

`--dry-run` lists changes without writing anything. In an interactive terminal it still asks configuration questions. `--json` with init/update requires `--non-interactive`; skill commands support `--json` with `--dry-run`. JSON output stays on stdout without spinner text; optional-skill notices go to stderr. Conflicts and partial results exit with status 1, including during dry-run. Choosing cancel in a conflict prompt leaves all files untouched; keyboard interruption exits with status 130. Invalid arguments and unsupported flag combinations fail before any writes.

Generation JSON keeps the `changes` and `conflicts` fields and adds `conflictDetails` and `recovered`. `planned` groups proposed `writes`, `removals`, `backups`, and `metadata`; `written`, `removed`, and `backups` list operations that actually completed. Preview and blocked results leave those applied-operation lists empty. Status is `preview`, `applied`, `partial`, `blocked`, or `cancelled`; a partial result exits with status 1 and lists skipped paths.

The `output` folder is relative to the project and uses `/` separators on all platforms. Traversal and reserved metadata directories are rejected. Folder names containing spaces, Unicode, `#`, or parentheses are supported, with encoded Markdown references.

## Stack detection and selection

The interactive stack picker groups checkboxes into programming languages, frameworks, and libraries/integrations. Each choice explains its role and automatic dependencies: Laravel includes PHP, Gin includes Go, and Next.js or the Inertia React adapter includes React. The selected stack drives generated guidance; detected technologies remain separate evidence. Initial skill checkboxes recommend common and stack-relevant skills, and can be changed before generation. UI skills are recommended only when the selected stack or scanned files indicate a UI surface; Laravel by itself does not imply one.

Languages are detected from source file extensions: JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`), TypeScript (`.ts`, `.tsx`, `.mts`, `.cts`), PHP (`.php`), and Go (`.go`). A `package.json` indicates the JavaScript package ecosystem, not that the project contains JavaScript source; a TypeScript dependency alone does not mark TypeScript as a source language. Frameworks and libraries are detected from their manifests. JavaScript commands use `packageManager` metadata or a unique recognized lockfile; ambiguous lockfiles do not produce guessed package commands. Source scanning skips VCS, dependency, build and cache directories, ignores symlinks, and reports when its 20,000-entry or depth-64 budget is reached. Project JSON inputs over 32 MiB are skipped with a diagnostic.

## Generated files and updates

Documentation defaults to `ai-agent-docs`. Selected skill guides are grouped under `engineering/` and `application/`; project context and workflow live under `project/`. Each native agent skill contains only its metadata and a link to the canonical guide, so project-specific rules have one editable source. The generated layout is:

```text
ai-agent-docs/
├── README.md
├── engineering/  # selected engineering skills
├── application/  # selected UI, route, and mascot skills
└── project/      # context.md, workflow.md; mascot.md after a mascot is selected
```

The project context map uses recognized manifests, source extensions and up to three representative paths per area. It records declared command names without copying script bodies or running them, and it does not infer business behavior or application architecture. Next.js guidance records App Router, Pages Router, mixed, or unknown based on route entry files.

| Agent          | Project instructions              | Native skills      |
| -------------- | --------------------------------- | ------------------ |
| Codex          | `AGENTS.md`                       | `.agents/skills`   |
| Claude Code    | `CLAUDE.md`                       | `.claude/skills`   |
| Gemini CLI     | `AGENTS.md`, `GEMINI.md`          | `.agents/skills`   |
| Cursor         | `AGENTS.md`, `.cursor/rules`      | `.agents/skills`   |
| OpenCode       | `AGENTS.md`                       | `.agents/skills`   |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/skills`   |
| Windsurf       | `AGENTS.md`, `.windsurf/rules`    | `.windsurf/skills` |
| Antigravity    | `AGENTS.md`                       | `.agents/skills`   |

Agent version and organization policies may affect discovery. Reload or restart the agent after generation if necessary. No global agent settings are changed, and installation does not run a hook that modifies project files.

The optional `mascot` skill is never recommended automatically for any stack. Enable it with `my-skill-gweh skill enable mascot` or choose it in `update --reconfigure`. Its short guide prioritizes an existing identity in `<output>/project/mascot.md`; detailed four-concept creation is in `application/mascot-concepts.md` and is opened only for a new identity or explicit redesign. The agent waits for a choice, removes rejected concepts from that exploration, validates the four-view guide, and records the selected identity. Future mascot images must attach the guide as an image reference. Assets follow the project's existing image folder convention, with `assets/mascot/` as the fallback. Agents without image generation or image-reference support save prompts and expected input/output paths, then wait for generated files.

Configuration lives in `.my-skill-gweh/config.json`; ownership fingerprints and generated guide baselines live in `.my-skill-gweh/manifest.json` and `.my-skill-gweh/baselines.json`. Commit these files alongside generated outputs. Baselines let updates merge independent edits to canonical guides. The CLI combines non-overlapping edits automatically and resolves overlapping sections one hunk at a time: keep the project text, use generated text, or keep both in project-then-generated order. A resolution is applied only while the reviewed file and generated snapshot remain unchanged. Older customized guides without a baseline require review. Generated YAML frontmatter stays at the beginning of native skill and rule files. New managed blocks include a content fingerprint so exact generated files can be recovered if the manifest is lost.

Existing plain instruction files receive a marked block. Text outside that block is preserved exactly on update. Recovery skips nested repositories and nested projects with their own `.my-skill-gweh/config.json`; output configured inside a nested project is blocked, so run the CLI from that child project root. Recovery is bounded and reports truncation. Exact legacy agent pointers are recovered automatically. During flat-layout migration, developer notes outside the managed block move into the matching grouped guide and the old file is backed up. Customized output removed from the configuration prompts whether to retain it as a plain document under `<output>/retained/` or delete it after making a complete backup under `.my-skill-gweh/backups/`. Retained documents have generator markers removed and local CommonMark links rebased. Other conflicts offer keep-and-skip, backup-and-replace, or cancel; keep-and-skip is the default. Skipping applies other safe changes and reports a partial result. Non-interactive runs stop without writing when a conflict needs a decision. CommonMark parsing is used for local-link checks and retained-document link updates.

Every destination, including metadata, is checked for symlinks and file/directory collisions before writing. Project inputs also avoid symlinks. A project lock records PID, host, and start time; `doctor` distinguishes active, stale, and unknown locks. Stale locks are not removed automatically: verify that the owner stopped before removing `.my-skill-gweh.lock`. Transactions recheck each file before changing it and avoid rolling back over a newer developer edit. Files are replaced individually using temporary files; ordinary write failures trigger rollback. This is not a crash-atomic filesystem transaction.

`doctor` reads saved configuration, diagnoses missing or invalid state, checks expected files and ownership fingerprints, lock state, and local Markdown file references. It ignores code examples and accepts file or directory links. It never runs project tests/builds or claims that an agent loaded the skill. Missing files, orphaned state, conflicts, drift, lock problems, or invalid references produce status 1.

## Presets

`preset save NAME` snapshots the current project's validated configuration without overwriting an existing preset. Interactive init offers saved presets before the other choices; the selected preset remains editable. `--config choices.json` chooses a different source. Names use lowercase letters, digits and hyphens.

Presets live under `$XDG_CONFIG_HOME/my-skill-gweh/presets`, or the platform's user configuration directory when it is unset. Read-only commands do not create this directory. `preset show NAME` prints reusable JSON; save that output to a file and pass it to `init --config`.

## Development

```sh
npm ci
npm run verify
```

`verify` runs formatting/type checks, unit and regression tests, creates the distributable tarball, then installs and smoke-tests that exact package. The token-budget regression test counts generated characters as a repeatable proxy across Indonesian/English output, representative stacks, and Codex/Claude entrypoints; character counts are not claimed as exact token counts. `npm run format` applies Prettier. CI runs the same command on Linux, macOS and Windows with Node.js 22 and 24.

Source responsibilities:

- `src/cli/`: argument validation, command orchestration, output and injectable wizard I/O.
- Configuration, catalog, guides, detection, project context and rendering modules: validated choices and deterministic, evidence-backed document content.
- Managed-content, generator, filesystem and transaction modules: ownership, preview planning and protected writes.
- Doctor and preset modules: diagnostics and saved user choices.
- `src/core.ts`: compatibility exports for the original module entrypoint.

## Build and npm publishing

`npm run package` produces an installable tarball and SHA-256 checksum in `artifacts/`. Each build removes the previous `dist/` directory so deleted source modules cannot remain in a release. `npm run test:package -- path/to/package.tgz` installs that exact tarball in a temporary directory and exercises the CLI without source files or devDependencies.

Releases use Release Please to open a version and changelog PR after conventional commits reach `main`. Merging that PR creates the GitHub Release and starts `.github/workflows/publish.yml`, which validates and smoke-tests the exact npm tarball before publishing it through Trusted Publishing (OIDC). Stable versions use `latest`; prereleases use `next`.

See [the release guide](docs/releasing.md) for the one-time GitHub App, branch protection and npm Trusted Publisher setup, plus the release and recovery steps. No `NPM_TOKEN` is needed, and release versions/tags are not created locally.

## Current limitations

Custom template/skill imports and multi-application discovery are not implemented yet. Run init separately inside each application.

No API key or network connection is required at runtime. Generated test and Git policies describe agent behavior; running this CLI does not execute those project actions.
