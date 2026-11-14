import path from 'node:path';
import { rules, type Agent, type Language, type Skill } from './catalog.js';
import { validate, BASELINE_PATH, CONFIG_PATH, MANIFEST_PATH, type Config } from './config.js';
import { safe } from './filesystem.js';
import {
  contextualGuideSections,
  guides,
  localized,
  mascotConceptSections,
  type GuideSection,
} from './guides.js';
import { collectProjectContext, type ProjectContext } from './project-context.js';
import { detect, type Detection } from './detection.js';
import { formatStack } from './stack.js';

const skillGroups: Record<Skill, 'engineering' | 'application'> = {
  quality: 'engineering',
  docs: 'engineering',
  contracts: 'engineering',
  testing: 'engineering',
  dependencies: 'engineering',
  'zero-any': 'engineering',
  routes: 'application',
  forms: 'application',
  'ui-size': 'application',
  'ui-tests': 'application',
  accessibility: 'application',
  mascot: 'application',
};

const skillDescriptions: Record<Skill, Record<Language, string>> = {
  quality: {
    en: 'Use for module boundaries, code organization, abstraction choices, and maintainability reviews.',
    id: 'Gunakan untuk batas modul, susunan kode, pilihan abstraksi, dan review kemudahan pemeliharaan.',
  },
  docs: {
    en: 'Use when a change affects behavior, setup, contracts, operations, or project documentation.',
    id: 'Gunakan saat perubahan memengaruhi perilaku, setup, kontrak, operasi, atau dokumentasi proyek.',
  },
  contracts: {
    en: 'Use when changing API behavior, authorization, ownership, privacy, or persistence boundaries.',
    id: 'Gunakan saat mengubah perilaku API, otorisasi, ownership, privasi, atau batas persistence.',
  },
  testing: {
    en: 'Use to plan or review regression coverage for changed behavior and failure cases.',
    id: 'Gunakan untuk merencanakan atau meninjau test regresi bagi perilaku dan kasus gagal yang berubah.',
  },
  'ui-size': {
    en: 'Use when reviewing large UI components or deciding whether a component should be split.',
    id: 'Gunakan saat meninjau komponen UI besar atau menentukan apakah komponen perlu dipecah.',
  },
  'zero-any': {
    en: 'Use when editing TypeScript types or reviewing `any` and type-suppression usage.',
    id: 'Gunakan saat mengedit tipe TypeScript atau meninjau penggunaan `any` dan penonaktifan tipe.',
  },
  routes: {
    en: 'Use when changing route registration, URL behavior, middleware, or navigation.',
    id: 'Gunakan saat mengubah registrasi route, perilaku URL, middleware, atau navigasi.',
  },
  forms: {
    en: 'Use when implementing form fields, validation, submission, and visible error states.',
    id: 'Gunakan saat membuat field form, validasi, submit, dan status error yang terlihat.',
  },
  'ui-tests': {
    en: 'Use when testing interactive UI behavior and user-visible outcomes.',
    id: 'Gunakan saat menguji interaksi UI dan hasil yang terlihat oleh pengguna.',
  },
  accessibility: {
    en: 'Use when changing controls, keyboard flow, focus behavior, or accessible names.',
    id: 'Gunakan saat mengubah kontrol, alur keyboard, focus, atau nama aksesibel.',
  },
  mascot: {
    en: 'Use when a developer asks to design a project mascot or create consistent mascot image variations.',
    id: 'Gunakan saat developer meminta desain maskot proyek atau variasi gambar maskot yang konsisten.',
  },
  dependencies: {
    en: 'Use when adding, updating, or removing project dependencies.',
    id: 'Gunakan saat menambah, memperbarui, atau menghapus dependency proyek.',
  },
};

export function skillGuidePath(output: string, skill: Skill): string {
  return `${output}/${skillGroups[skill]}/${skill}.md`;
}

export function projectGuidePath(output: string, guide: 'context' | 'workflow'): string {
  return `${output}/project/${guide}.md`;
}

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
  const extra = contextualGuideSections(
    skill,
    context.stack,
    context.sourceEvidence,
    context.nextRouter,
  );
  const sections = [...template.sections, ...extra].map((section) =>
    sectionMarkdown(section, language),
  );
  const example =
    template.example &&
    template.example.stacks?.some((technology) => context.stack.includes(technology))
      ? `## ${localized(template.example.title, language)}\n\n\`\`\`${template.example.language ?? 'text'}\n${template.example.code}\n\`\`\`\n`
      : '';
  const projectLink = localLink(
    skillGuidePath(config.output, skill),
    projectGuidePath(config.output, 'context'),
  );
  return [
    `# ${skill}\n\n${rules[skill][language]}`,
    ...sections,
    example,
    `[${language === 'en' ? 'Project context' : 'Konteks proyek'}](${projectLink})`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function mascotConceptMarkdown(language: Language): string {
  const intro =
    language === 'en'
      ? 'Read this workflow only when creating a new mascot identity or explicitly redesigning one.'
      : 'Baca alur ini hanya saat membuat identitas maskot baru atau melakukan redesign yang diminta.';
  return [
    `# ${language === 'en' ? 'Mascot concept workflow' : 'Alur konsep maskot'}`,
    intro,
    ...mascotConceptSections.map((section) => sectionMarkdown(section, language)),
  ].join('\n\n');
}

function nativeSkillMarkdown(skill: Skill, file: string, config: Config): string {
  const language = config.docsLanguage;
  const canonicalGuide = localLink(file, skillGuidePath(config.output, skill));
  const instruction = language === 'en' ? 'Follow the project guide:' : 'Ikuti panduan proyek:';
  return `# ${skill}\n\n${instruction} [${skill}](${canonicalGuide})`;
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
  if (context.packageManager || context.packageManagerEvidence.length) {
    lines.push('', `## ${heading('Package manager', 'Package manager')}`, '');
    lines.push(
      context.packageManager
        ? code(context.packageManager)
        : heading(
            'Not identified; no package command is assumed.',
            'Tidak teridentifikasi; command package tidak diasumsikan.',
          ),
    );
    if (context.packageManagerEvidence.length) {
      lines.push(
        `- ${heading('Evidence', 'Bukti')}: ${context.packageManagerEvidence.map(code).join(', ')}`,
      );
    }
    if (context.packageManagerConflict) {
      lines.push(`- ${heading('Warning', 'Peringatan')}: ${code(context.packageManagerConflict)}`);
    } else if (context.packageManagerAmbiguous) {
      lines.push(
        `- ${heading('Warning', 'Peringatan')}: ${heading('Multiple lockfiles are present; verify the intended package manager.', 'Ada beberapa lockfile; verifikasi package manager yang digunakan.')}`,
      );
    }
  }
  lines.push('', `## ${heading('Selected stack', 'Stack pilihan')}`, '');
  lines.push(
    formatStack(context.stack, language, { markdown: true }) ||
      heading('No stack evidence found.', 'Tidak ada bukti stack yang ditemukan.'),
  );
  lines.push('', `## ${heading('Detected stack evidence', 'Bukti stack terdeteksi')}`, '');
  lines.push(
    formatStack(context.detectedStack, language, { markdown: true }) ||
      heading('No stack evidence found.', 'Tidak ada bukti stack yang ditemukan.'),
  );
  if (context.stack.includes('nextjs')) {
    const routers: Record<ProjectContext['nextRouter'], { en: string; id: string }> = {
      app: { en: 'App Router', id: 'App Router' },
      pages: { en: 'Pages Router', id: 'Pages Router' },
      mixed: { en: 'App Router and Pages Router', id: 'App Router dan Pages Router' },
      unknown: {
        en: 'Not identified from route entry files',
        id: 'Belum teridentifikasi dari file route',
      },
    };
    lines.push(
      '',
      `- ${heading('Next.js router', 'Router Next.js')}: ${routers[context.nextRouter][language]}`,
    );
  }

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
        'Representative paths are navigation hints, not proof of behavior.',
        'Path contoh hanya petunjuk navigasi, bukan bukti perilaku.',
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
  if (context.diagnostics.length) {
    lines.push('', `## ${heading('Detection notes', 'Catatan deteksi')}`, '');
    lines.push(context.diagnostics.map((item) => `- ${item}`).join('\n'));
  }

  return `${lines.join('\n')}\n`;
}

function gitWorkflow(policy: Config['git'], language: Language): string {
  if (policy === 'existing') {
    return language === 'en'
      ? "Use the repository's documented branch and review conventions. Inspect the branch and working tree before finishing. Ask before committing, pushing, merging, or creating a remote resource unless the current task explicitly requests that action."
      : 'Ikuti konvensi branch dan review yang didokumentasikan repository. Periksa branch dan working tree sebelum selesai. Minta izin sebelum commit, push, merge, atau membuat resource remote kecuali tindakan itu diminta secara eksplisit dalam tugas.';
  }
  if (policy === 'feature-pr') {
    return language === 'en'
      ? 'Create a focused feature branch from the current integration branch. Implement the request, run allowed checks, inspect the final diff, and summarize the change. Ask before committing, pushing, or opening a PR unless requested; ask separately before merging unless the task requests the merge.'
      : 'Buat feature branch terfokus dari branch integrasi saat ini. Implementasikan permintaan, jalankan pemeriksaan yang diizinkan, tinjau diff akhir, lalu rangkum perubahan. Minta izin sebelum commit, push, atau membuka PR kecuali diminta; minta izin terpisah sebelum merge kecuali tugas meminta merge tersebut.';
  }
  return language === 'en'
    ? 'Create a focused feature branch from staging. After review, ask before committing or pushing it to staging unless requested. Run the agreed checks, then ask separately before promoting staging to main unless the task requests promotion. Never merge or push to main without explicit approval.'
    : 'Buat feature branch terfokus dari staging. Setelah review, minta izin sebelum commit atau push ke staging kecuali diminta. Jalankan pemeriksaan yang disepakati, lalu minta izin terpisah sebelum mempromosikan staging ke main kecuali tugas meminta promosi. Jangan merge atau push ke main tanpa persetujuan eksplisit.';
}

/** Check all file/directory collisions before any output can be written. */
export function renderDocuments(
  root: string,
  config: Config,
  _detection: Detection,
  context: ProjectContext,
): Record<string, Document> {
  validate(config);
  safe(root, config.output);
  const documents: Record<string, Document> = {};
  const language = config.docsLanguage;
  const english = language === 'en';
  const indexFile = `${config.output}/README.md`;
  const contextFile = projectGuidePath(config.output, 'context');
  const workflowFile = projectGuidePath(config.output, 'workflow');
  const engineeringSkills = (Object.keys(skillGroups) as Skill[]).filter(
    (skill) => skillGroups[skill] === 'engineering' && config.skills.includes(skill),
  );
  const applicationSkills = (Object.keys(skillGroups) as Skill[]).filter(
    (skill) => skillGroups[skill] === 'application' && config.skills.includes(skill),
  );
  const indexGroup = (title: string, skills: Skill[]): string =>
    skills.length
      ? `## ${title}\n\n${skills.map((skill) => `- [${skill}](${skillGroups[skill]}/${skill}.md)`).join('\n')}`
      : '';
  const pointer = (file: string): string =>
    english
      ? `Start with the [index](${localLink(file, indexFile)}); read only the relevant skill guide. Open the [project workflow](${localLink(file, workflowFile)}) before running checks or changing Git state, and follow more specific repository instructions. For database work, ask whether production may be reset: if yes, edit existing migrations; if no, add a data-preserving migration.\n`
      : `Mulai dari [index](${localLink(file, indexFile)}); baca hanya panduan skill yang relevan. Buka [workflow proyek](${localLink(file, workflowFile)}) sebelum menjalankan pemeriksaan atau mengubah state Git, lalu ikuti instruksi repository yang lebih spesifik. Untuk tugas database, tanyakan apakah production boleh di-fresh: jika boleh, edit migrasi yang ada; jika tidak, tambahkan migrasi yang menjaga data.\n`;

  documents[indexFile] = {
    body:
      [
        `# ${english ? 'Project guidelines' : 'Panduan proyek'}`,
        english
          ? 'Open only the guide relevant to the current task. Project context and workflow are available when needed.'
          : 'Buka hanya panduan yang relevan dengan tugas. Peta konteks dan workflow tersedia saat diperlukan.',
        indexGroup(english ? 'Engineering' : 'Engineering', engineeringSkills),
        indexGroup(english ? 'Application' : 'Aplikasi', applicationSkills),
        `## ${english ? 'Project' : 'Proyek'}\n\n- [${english ? 'Project context map' : 'Peta konteks proyek'}](project/context.md)\n- [Workflow](project/workflow.md)`,
      ]
        .filter(Boolean)
        .join('\n\n') + '\n',
  };
  documents[contextFile] = { body: projectMap(context, config) };

  for (const id of config.skills) {
    documents[skillGuidePath(config.output, id)] = {
      body: `${guideMarkdown(id, config, context)}\n`,
    };
  }
  if (config.skills.includes('mascot')) {
    documents[`${config.output}/application/mascot-concepts.md`] = {
      body: `${mascotConceptMarkdown(config.docsLanguage)}\n`,
    };
  }

  const policy =
    config.validation === 'ask'
      ? english
        ? 'Ask before running tests, lint, typecheck, or builds unless the current task explicitly requests those checks.'
        : 'Minta izin sebelum menjalankan test, lint, typecheck, atau build kecuali pemeriksaan tersebut diminta secara eksplisit dalam tugas.'
      : english
        ? 'Run relevant project checks and report actual results.'
        : 'Jalankan pemeriksaan proyek yang relevan dan laporkan hasil aktual.';
  const workflow = english
    ? 'Follow established repository patterns and verify them in source files. Keep changes within the requested scope. Update the owning documentation when behavior, setup, contracts or operations change. Never claim a command passed unless it was run successfully.'
    : 'Ikuti pola repository yang sudah ada dan verifikasi melalui file source. Batasi perubahan pada scope yang diminta. Perbarui dokumentasi pemilik ketika perilaku, setup, kontrak, atau operasi berubah. Jangan menyatakan command berhasil jika belum dijalankan dengan sukses.';
  const stack = formatStack(config.stack, language, { markdown: true });
  const detected = formatStack(context.detectedStack, language, { markdown: true });
  const workflowStack = english
    ? `## Selected stack\n\n${stack || 'No stack selected.'}\n\n## Detected evidence\n\n${detected || 'No stack evidence detected.'}`
    : `## Stack pilihan\n\n${stack || 'Belum ada stack dipilih.'}\n\n## Bukti deteksi\n\n${detected || 'Tidak ada bukti stack terdeteksi.'}`;
  const gitInstructions = gitWorkflow(config.git, language);
  documents[workflowFile] = {
    body: `# Workflow\n\n${policy}\n\n${workflow}\n\n${workflowStack}\n\n## ${english ? 'Git workflow' : 'Workflow Git'}\n\n${gitInstructions}\n\n[${english ? 'Project context map' : 'Peta konteks proyek'}](${localLink(workflowFile, contextFile)})\n`,
  };
  const agentsNeedingAgentsMd = new Set([
    'codex',
    'gemini',
    'cursor',
    'opencode',
    'windsurf',
    'antigravity',
  ]);
  if (config.agents.some((agent) => agentsNeedingAgentsMd.has(agent))) {
    documents['AGENTS.md'] = { body: pointer('AGENTS.md'), appendable: true };
  }

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
      const description = skillDescriptions[id][language];
      documents[file] = {
        frontmatter: `---\nname: ${name}\ndescription: ${description}\n---\n`,
        body: `${nativeSkillMarkdown(id, file, config)}\n`,
      };
    }
  }
  assertDistinctPaths(root, [...Object.keys(documents), CONFIG_PATH, MANIFEST_PATH, BASELINE_PATH]);
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
