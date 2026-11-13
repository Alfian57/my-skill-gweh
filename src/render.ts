import path from 'node:path';
import { rules, type Agent } from './catalog.js';
import { validate, CONFIG_PATH, MANIFEST_PATH, type Config } from './config.js';
import { safe } from './filesystem.js';

export interface Document {
  body: string;
  frontmatter?: string;
  appendable?: boolean;
}

const adapters: Partial<Record<Agent, { file: string; frontmatter?: string }>> = {
  claude: { file: 'CLAUDE.md' },
  gemini: { file: 'GEMINI.md' },
  cursor: { file: '.cursor/rules/my-skill-gweh.mdc', frontmatter: '---\nalwaysApply: true\n---\n' },
  copilot: { file: '.github/copilot-instructions.md' },
  windsurf: {
    file: '.windsurf/rules/my-skill-gweh.md',
    frontmatter: '---\ntrigger: always_on\n---\n',
  },
};

function skillDirectory(agent: Agent): string {
  switch (agent) {
    case 'claude':
      return '.claude/skills';
    case 'copilot':
      return '.github/skills';
    case 'windsurf':
      return '.windsurf/skills';
    default:
      return '.agents/skills';
  }
}

export function localLink(from: string, to: string): string {
  return path.posix
    .relative(path.posix.dirname(from), to)
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(
        /[()]/gu,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}

/** Check all file/directory collisions before any output can be written. */
export function assertDistinctPaths(root: string, files: string[]): void {
  // Reject case-only collisions on every OS so generated layouts remain portable.
  const destinations = new Set(files.map((file) => safe(root, file).toLowerCase()));
  for (const destination of destinations) {
    let parent = path.dirname(destination);
    while (parent !== path.dirname(parent)) {
      if (destinations.has(parent))
        throw new Error(`Output file conflicts with directory: ${parent}`);
      parent = path.dirname(parent);
    }
  }
}

export function renderDocuments(root: string, config: Config): Record<string, Document> {
  validate(config);
  safe(root, config.output);
  const documents: Record<string, Document> = {};
  const language = config.docsLanguage;
  const english = language === 'en';
  const indexFile = `${config.output}/README.md`;
  const pointer = (file: string): string =>
    english
      ? `Read [engineering guidelines](${localLink(file, indexFile)}) and the linked workflow before editing.\n`
      : `Baca [panduan engineering](${localLink(file, indexFile)}) dan workflow terkait sebelum mengedit.\n`;

  const links = config.skills.map((id) => `- [${id}](${id}.md)`).join('\n');
  documents[indexFile] = {
    body: `# ${english ? 'Engineering guidelines' : 'Panduan engineering'}\n\n${links}\n\n[Workflow](workflow.md)\n`,
  };
  for (const id of config.skills) {
    documents[`${config.output}/${id}.md`] = { body: `# ${id}\n\n${rules[id][language]}\n` };
  }

  const policy =
    config.validation === 'ask'
      ? english
        ? 'Ask the user before running tests, lint, typecheck or builds.'
        : 'Minta izin sebelum menjalankan test, lint, typecheck, atau build.'
      : english
        ? 'Run relevant project checks and report actual results.'
        : 'Jalankan pemeriksaan proyek yang relevan dan laporkan hasil aktual.';
  const workflow = english
    ? 'Follow existing repository conventions. Limit cleanup to the active task. Git operations require user authorization.'
    : 'Ikuti konvensi repository. Batasi pembersihan pada task aktif. Operasi Git memerlukan otorisasi pengguna.';
  // A code span keeps user-supplied stack names from becoming Markdown syntax.
  const stack = config.stack.map((name) => `\`${name.replaceAll('`', '')}\``).join(', ');
  documents[`${config.output}/workflow.md`] = {
    body: `# Workflow\n\n${policy}\n\n${workflow}\n\nGit: ${config.git}\nStack: ${stack}\n`,
  };
  documents['AGENTS.md'] = { body: pointer('AGENTS.md'), appendable: true };

  for (const agent of config.agents) {
    const adapter = adapters[agent];
    if (adapter) {
      documents[adapter.file] = {
        body: pointer(adapter.file),
        ...(adapter.frontmatter ? { frontmatter: adapter.frontmatter } : { appendable: true }),
      };
    }
  }

  for (const directory of new Set(config.agents.map(skillDirectory))) {
    for (const id of config.skills) {
      const name = `my-skill-gweh-${id}`;
      const file = `${directory}/${name}/SKILL.md`;
      const description = english
        ? `Apply ${id} guidance when editing or reviewing this project.`
        : `Terapkan panduan ${id} saat mengedit atau meninjau proyek ini.`;
      documents[file] = {
        frontmatter: `---\nname: ${name}\ndescription: ${description}\n---\n`,
        body: `${pointer(file)}\n${rules[id][language]}\n`,
      };
    }
  }
  assertDistinctPaths(root, [...Object.keys(documents), CONFIG_PATH, MANIFEST_PATH]);
  return documents;
}

export async function render(root: string, config: Config): Promise<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(renderDocuments(root, config)).map(([file, document]) => [
      file,
      (document.frontmatter ?? '') + document.body,
    ]),
  );
}
