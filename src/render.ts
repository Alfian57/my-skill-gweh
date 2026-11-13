import path from 'node:path';
import { rules, type Agent, type Language, type Skill } from './catalog.js';
import { validate, CONFIG_PATH, MANIFEST_PATH, type Config } from './config.js';
import { safe } from './filesystem.js';
import { contextualGuideSections, guides, localized, type GuideSection } from './guides.js';
import { collectProjectContext, type ProjectContext } from './project-context.js';
import { detect, type Detection } from './detection.js';
import { formatStack } from './stack.js';

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

function code(value: string): string {
  return `\`${value.replaceAll('`', "'").replace(/[\r\n]+/gu, ' ')}\``;
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

function sectionMarkdown(section: GuideSection, language: Language): string {
  const paragraphs = (section.paragraphs ?? []).map((paragraph) => localized(paragraph, language));
  const bullets = section.bullets.map((bullet) => `- ${localized(bullet, language)}`);
  return `## ${localized(section.title, language)}\n\n${[...paragraphs, ...bullets].join('\n\n')}\n`;
}

function guideMarkdown(skill: Skill, config: Config, context: ProjectContext): string {
  const language = config.docsLanguage;
  const template = guides[skill];
  const extra = contextualGuideSections(skill, context.stack, context.sourceEvidence);
  const sections = [...template.sections, ...extra].map((section) =>
    sectionMarkdown(section, language),
  );
  const example = template.example
    ? `## ${localized(template.example.title, language)}\n\n\`\`\`${skill === 'zero-any' ? 'ts' : 'php'}\n${template.example.code}\n\`\`\`\n`
    : '';
  const checklistTitle = language === 'en' ? 'Review checklist' : 'Checklist review';
  const projectLink = localLink(
    `${config.output}/${skill}.md`,
    `${config.output}/project-context.md`,
  );
  const workflowLink = localLink(`${config.output}/${skill}.md`, `${config.output}/workflow.md`);
  return [
    `# ${skill}\n\n${rules[skill][language]}`,
    ...sections,
    example,
    `## ${checklistTitle}\n\n${template.checklist.map((item) => `- [ ] ${localized(item, language)}`).join('\n')}`,
    `[${language === 'en' ? 'Project context map' : 'Peta konteks proyek'}](${projectLink}) · [Workflow](${workflowLink})`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function nativeSkillMarkdown(
  skill: Skill,
  file: string,
  config: Config,
  context: ProjectContext,
): string {
  const language = config.docsLanguage;
  const template = guides[skill];
  const extra = contextualGuideSections(skill, context.stack, context.sourceEvidence);
  const usefulBullets = [
    ...template.sections.flatMap((section) => section.bullets),
    ...extra.flatMap((section) => section.bullets),
  ].slice(0, 5);
  const fullGuide = localLink(file, `${config.output}/${skill}.md`);
  const projectMap = localLink(file, `${config.output}/project-context.md`);
  const title = language === 'en' ? 'Apply this skill' : 'Terapkan skill ini';
  const checks = language === 'en' ? 'Before finishing' : 'Sebelum selesai';
  const verify = template.checklist.slice(0, 2).map((item) => `- [ ] ${localized(item, language)}`);
  const instructions = usefulBullets.map((item) => `- ${localized(item, language)}`);
  return `# ${skill}\n\n${rules[skill][language]}\n\n## ${title}\n\n${instructions.join('\n')}\n\n## ${checks}\n\n${verify.join('\n')}\n\n[${language === 'en' ? 'Read the full guide' : 'Baca panduan lengkap'}](${fullGuide}) · [${language === 'en' ? 'Project context map' : 'Peta konteks proyek'}](${projectMap})`;
}

function projectMap(context: ProjectContext, config: Config): string {
  const language = config.docsLanguage;
  const english = language === 'en';
  const heading = (en: string, id: string): string => (english ? en : id);
  const lines = [
    `# ${heading('Project context map', 'Peta konteks proyek')}`,
    '',
    heading(
      'Evidence collected from recognized manifests, source file extensions, and repository paths. This map does not infer business behavior and does not execute project scripts.',
      'Bukti dikumpulkan dari manifest yang dikenali, ekstensi source, dan path repository. Peta ini tidak menyimpulkan perilaku bisnis dan tidak menjalankan script proyek.',
    ),
  ];

  if (context.name) lines.push('', `## ${heading('Project', 'Proyek')}`, '', code(context.name));
  lines.push('', `## ${heading('Detected stack', 'Stack terdeteksi')}`, '');
  lines.push(
    formatStack(context.stack, language, { markdown: true }) ||
      heading('No stack evidence found.', 'Tidak ada bukti stack yang ditemukan.'),
  );

  if (context.ecosystems.length || context.sourceEvidence.length) {
    lines.push('', `## ${heading('Repository evidence', 'Bukti repository')}`, '');
    if (context.ecosystems.length) {
      const labels: Record<string, { en: string; id: string }> = {
        'javascript-packages': {
          en: 'JavaScript package manifest',
          id: 'Manifest package JavaScript',
        },
        composer: { en: 'Composer manifest', id: 'Manifest Composer' },
        'go-modules': { en: 'Go module', id: 'Modul Go' },
      };
      lines.push(
        `- ${heading('Ecosystems', 'Ekosistem')}: ${context.ecosystems.map((item) => labels[item]?.[language] ?? code(item)).join(', ')}`,
      );
    }
    if (context.sourceEvidence.length) {
      lines.push(
        `- ${heading('Source extensions found', 'Ekstensi source ditemukan')}: ${context.sourceEvidence.map(code).join(', ')}`,
      );
    }
  }

  if (context.facts.length) {
    lines.push('', `## ${heading('Manifest facts', 'Fakta manifest')}`, '');
    for (const fact of context.facts) {
      lines.push(
        `- **${localized(fact.label, language)}:** ${code(fact.value)} — ${heading('evidence', 'bukti')}: ${code(fact.source)}`,
      );
    }
  }

  if (context.commands.length) {
    lines.push('', `## ${heading('Declared commands', 'Command yang dideklarasikan')}`, '');
    lines.push(
      heading(
        'These invocations are derived from script names in manifests. Their definitions are not copied or executed; verify the relevant command before running it.',
        'Pemanggilan ini berasal dari nama script di manifest. Definisi script tidak disalin atau dijalankan; periksa command terkait sebelum menjalankannya.',
      ),
    );
    for (const command of context.commands) {
      lines.push(
        `- ${code(command.invocation)} — ${heading('declared in', 'dideklarasikan di')} ${code(`${command.manager === 'composer' ? 'composer.json' : 'package.json'} (${command.name})`)}`,
      );
    }
  }

  if (context.areas.length) {
    lines.push('', `## ${heading('Repository map', 'Peta repository')}`, '');
    lines.push(
      heading(
        'Paths below are a bounded sample of files in recognized areas. Inspect the actual files before treating a path name as proof of behavior.',
        'Path di bawah adalah sampel terbatas file di area yang dikenali. Buka file sebenarnya sebelum menganggap nama path sebagai bukti perilaku.',
      ),
    );
    for (const area of context.areas) {
      lines.push(
        '',
        `### ${localized(area.label, language)}`,
        '',
        area.paths.map((item) => `- ${code(item)}`).join('\n'),
      );
    }
  }

  if (context.instructions.length) {
    lines.push(
      '',
      `## ${heading('Existing agent instructions', 'Instruksi agent yang sudah ada')}`,
      '',
    );
    lines.push(context.instructions.map((item) => `- ${code(item)}`).join('\n'));
  }
  if (context.existingSkills.length) {
    lines.push('', `## ${heading('Existing skills', 'Skill yang sudah ada')}`, '');
    lines.push(context.existingSkills.map((item) => `- ${code(item)}`).join('\n'));
  }

  return `${lines.join('\n')}\n`;
}

/** Check all file/directory collisions before any output can be written. */
export function renderDocuments(
  root: string,
  config: Config,
  detection: Detection,
  context: ProjectContext,
): Record<string, Document> {
  validate(config);
  safe(root, config.output);
  const documents: Record<string, Document> = {};
  const language = config.docsLanguage;
  const english = language === 'en';
  const indexFile = `${config.output}/README.md`;
  const contextFile = `${config.output}/project-context.md`;
  const workflowFile = `${config.output}/workflow.md`;
  const pointer = (file: string): string =>
    english
      ? `Before editing, read the [engineering guidelines](${localLink(file, indexFile)}), [project context map](${localLink(file, contextFile)}), and [workflow](${localLink(file, workflowFile)}). Then open the relevant skill guide linked from the index. Follow more specific repository instructions where they apply.\n`
      : `Sebelum mengedit, baca [panduan engineering](${localLink(file, indexFile)}), [peta konteks proyek](${localLink(file, contextFile)}), dan [workflow](${localLink(file, workflowFile)}). Lalu buka panduan skill terkait dari index. Ikuti instruksi repository yang lebih spesifik bila berlaku.\n`;

  const selectedGuides = config.skills.map((id) => `- [${id}](${id}.md)`).join('\n');
  documents[indexFile] = {
    body: `# ${english ? 'Engineering guidelines' : 'Panduan engineering'}\n\n${english ? 'Read these project rules before implementation. Each guide has detailed instructions, checks and examples where relevant.' : 'Baca aturan proyek ini sebelum implementasi. Setiap panduan berisi instruksi terperinci, pemeriksaan, dan contoh bila relevan.'}\n\n${selectedGuides}\n\n- [${english ? 'Project context map' : 'Peta konteks proyek'}](project-context.md)\n- [Workflow](workflow.md)\n`,
  };
  documents[contextFile] = { body: projectMap(context, config) };

  for (const id of config.skills) {
    documents[`${config.output}/${id}.md`] = { body: `${guideMarkdown(id, config, context)}\n` };
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
    ? 'Follow established repository patterns and verify them in source files. Keep changes within the requested scope. Update the owning documentation when behavior, setup, contracts or operations change. Never claim a command passed unless it was run successfully.'
    : 'Ikuti pola repository yang sudah ada dan verifikasi melalui file source. Batasi perubahan pada scope yang diminta. Perbarui dokumentasi pemilik ketika perilaku, setup, kontrak, atau operasi berubah. Jangan menyatakan command berhasil jika belum dijalankan dengan sukses.';
  const stack = formatStack(config.stack, language, { markdown: true });
  const detected = formatStack(detection.stack, language, { markdown: true });
  const workflowStack = english
    ? `## Selected stack\n\n${stack || 'No stack selected.'}\n\n## Detected evidence\n\n${detected || 'No stack evidence detected.'}`
    : `## Stack pilihan\n\n${stack || 'Belum ada stack dipilih.'}\n\n## Bukti deteksi\n\n${detected || 'Tidak ada bukti stack terdeteksi.'}`;
  documents[workflowFile] = {
    body: `# Workflow\n\n${policy}\n\n${workflow}\n\n${workflowStack}\n\nGit: ${config.git}\n\n[${english ? 'Project context map' : 'Peta konteks proyek'}](${localLink(workflowFile, contextFile)})\n`,
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
        body: `${nativeSkillMarkdown(id, file, config, context)}\n`,
      };
    }
  }
  assertDistinctPaths(root, [...Object.keys(documents), CONFIG_PATH, MANIFEST_PATH]);
  return documents;
}

export async function render(root: string, config: Config): Promise<Record<string, string>> {
  const detection = await detect(root);
  const context = await collectProjectContext(root, config, detection);
  return Object.fromEntries(
    Object.entries(renderDocuments(root, config, detection, context)).map(([file, document]) => [
      file,
      (document.frontmatter ?? '') + document.body,
    ]),
  );
}
