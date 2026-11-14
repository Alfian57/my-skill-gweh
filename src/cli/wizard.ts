import * as prompts from '@clack/prompts';
import { agents, rules, skillIds, SKILL_CATALOG_REVISION, type Language } from '../catalog.js';
import { validateOutput, parseConfig, type Config } from '../config.js';
import { CancelledError, errorMessage } from '../errors.js';
import type { Detection } from '../detection.js';
import { listPresets, showPreset } from '../presets.js';
import {
  formatStack,
  resolveStack,
  stackCatalog,
  type StackCategory,
  type StackTechnology,
} from '../stack.js';

export type MergeChoice = 'local' | 'generated' | 'both';

export type Prompts = Pick<
  typeof prompts,
  'intro' | 'select' | 'text' | 'multiselect' | 'groupMultiselect' | 'note' | 'confirm'
>;

export type ConflictDecision = 'replace' | 'retain' | 'delete' | 'skip' | 'cancel';

const commonSkills = ['quality', 'docs', 'contracts', 'testing', 'dependencies'] as const;
const skillLabels: Record<Language, Record<(typeof skillIds)[number], string>> = {
  en: {
    quality: 'Code quality',
    docs: 'Documentation',
    contracts: 'API and data contracts',
    testing: 'Testing',
    'ui-size': 'UI component size',
    'zero-any': 'TypeScript type safety',
    routes: 'Routes and URLs',
    forms: 'Forms and validation',
    'ui-tests': 'UI tests',
    accessibility: 'Accessibility',
    mascot: 'UI mascot (optional)',
    dependencies: 'Dependencies',
  },
  id: {
    quality: 'Kualitas kode',
    docs: 'Dokumentasi',
    contracts: 'Kontrak API dan data',
    testing: 'Pengujian',
    'ui-size': 'Ukuran komponen UI',
    'zero-any': 'Keamanan tipe TypeScript',
    routes: 'Route dan URL',
    forms: 'Form dan validasi',
    'ui-tests': 'Test UI',
    accessibility: 'Aksesibilitas',
    mascot: 'Maskot UI (opsional)',
    dependencies: 'Dependency',
  },
};

export function recommendedSkills(stack: readonly string[], uiEvidence = false): Config['skills'] {
  const selected = new Set(resolveStack(stack).values);
  const recommendations = new Set<string>(commonSkills);
  if (selected.has('typescript')) recommendations.add('zero-any');
  if (['laravel', 'gin', 'nextjs'].some((technology) => selected.has(technology))) {
    recommendations.add('routes');
  }
  if (uiEvidence || ['react', 'nextjs', 'inertia'].some((technology) => selected.has(technology))) {
    for (const skill of ['forms', 'ui-size', 'ui-tests', 'accessibility']) {
      recommendations.add(skill);
    }
  }
  return skillIds.filter((skill) => recommendations.has(skill));
}

const stackGroups: Record<Language, Record<StackCategory, string>> = {
  id: { language: 'Bahasa pemrograman', framework: 'Framework', library: 'Library dan integrasi' },
  en: {
    language: 'Programming languages',
    framework: 'Frameworks',
    library: 'Libraries and integrations',
  },
};

const ecosystemLabels: Record<Language, Record<string, string>> = {
  id: {
    'javascript-packages': 'Ekosistem JavaScript (package.json)',
    composer: 'Ekosistem PHP (Composer)',
    'go-modules': 'Modul Go (go.mod)',
  },
  en: {
    'javascript-packages': 'JavaScript ecosystem (package.json)',
    composer: 'PHP ecosystem (Composer)',
    'go-modules': 'Go modules (go.mod)',
  },
};

function detectedSummary(detection: Detection, language: Language): string {
  const english = language === 'en';
  const stack = formatStack(detection.stack, language);
  const lines = [
    stack ||
      (english
        ? 'No supported language or framework detected.'
        : 'Bahasa atau framework yang didukung belum terdeteksi.'),
  ];
  if (detection.ecosystems.length) {
    lines.push(
      `${english ? 'Ecosystems' : 'Ekosistem'}: ${detection.ecosystems
        .map((value) => ecosystemLabels[language][value] ?? value)
        .join(', ')}`,
    );
  }
  if (detection.sourceEvidence.length) {
    lines.push(
      `${english ? 'Source file extensions' : 'Ekstensi source'}: ${detection.sourceEvidence.join(', ')}`,
    );
  }
  if (detection.evidence.length) {
    lines.push(`${english ? 'Manifest files' : 'File manifest'}: ${detection.evidence.join(', ')}`);
  }
  if (detection.packageManager) {
    lines.push(`${english ? 'Package manager' : 'Package manager'}: ${detection.packageManager}`);
  } else if (detection.packageManagerAmbiguous) {
    lines.push(
      `${english ? 'Package manager' : 'Package manager'}: ${english ? 'ambiguous' : 'ambigu'}, ${(detection.packageManagerEvidence ?? []).filter((file) => !file.endsWith('.json')).join(', ')}`,
    );
  }
  if (detection.packageManagerConflict) {
    lines.push(
      `${english ? 'Package manager warning' : 'Peringatan package manager'}: ${detection.packageManagerConflict}`,
    );
  }
  const commands = Object.entries(detection.commands).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (commands.length) {
    lines.push(
      `${english ? 'Declared project scripts' : 'Script proyek yang terdaftar'}: ${commands
        .map(([name, command]) => `${name}: ${command}`)
        .join('; ')}`,
    );
  }
  return lines.join('\n');
}

function stackOptions(language: Language, current: readonly string[]) {
  const options: Record<string, { value: string; label: string; hint: string }[]> = {};
  for (const technology of Object.keys(stackCatalog) as StackTechnology[]) {
    const entry = stackCatalog[technology];
    const group = stackGroups[language][entry.category];
    (options[group] ??= []).push({
      value: technology,
      label: entry.label[language],
      hint: entry.description[language],
    });
  }

  const custom = [...new Set(current)].filter((value) => !Object.hasOwn(stackCatalog, value));
  if (custom.length) {
    options[
      language === 'id' ? 'Stack khusus dari konfigurasi' : 'Custom values from configuration'
    ] = custom.map((value) => ({ value, label: value, hint: '' }));
  }
  return options;
}

function answer<T>(value: T | symbol): Exclude<T, symbol> {
  if (typeof value === 'symbol') throw new CancelledError();
  return value as Exclude<T, symbol>;
}

export async function configure(
  initial: Config,
  detection: Detection,
  io: Prompts = prompts,
  options: {
    recommendSkills?: boolean;
    includeDetectedStack?: boolean;
    presetDirectory?: string;
  } = {},
): Promise<Config> {
  let config = parseConfig(initial);
  let usedPreset = false;
  io.intro('My Skill Gweh');
  if (options.presetDirectory) {
    const saved = await listPresets(options.presetDirectory);
    if (saved.length) {
      const keep = '__current__';
      const selected = answer(
        await io.select<string>({
          message: 'Saved project preset / Preset proyek tersimpan',
          options: [
            { value: keep, label: 'Keep current choices / Gunakan pilihan saat ini' },
            ...saved.map((name) => ({ value: name, label: name })),
          ],
          initialValue: keep,
        }),
      );
      if (selected !== keep) {
        config = await showPreset(options.presetDirectory, selected);
        usedPreset = true;
      }
    }
  }
  config.language = answer(
    await io.select<Language>({
      message: 'Bahasa CLI / CLI language',
      options: [
        { value: 'id', label: 'Indonesia' },
        { value: 'en', label: 'English' },
      ],
      initialValue: config.language,
    }),
  );
  const english = config.language === 'en';
  config.output = answer(
    await io.text({
      message: english ? 'Documentation folder' : 'Folder dokumentasi',
      defaultValue: config.output,
      placeholder: config.output,
      validate(value) {
        try {
          validateOutput(value ?? config.output);
        } catch (error) {
          return errorMessage(error);
        }
        return undefined;
      },
    }),
  );
  config.docsLanguage = answer(
    await io.select<Language>({
      message: english ? 'Documentation language' : 'Bahasa dokumentasi',
      options: [
        { value: 'en', label: 'English' },
        { value: 'id', label: 'Indonesia' },
      ],
      initialValue: config.docsLanguage,
    }),
  );
  io.note(
    detectedSummary(detection, config.language),
    english ? 'Detected project' : 'Hasil deteksi',
  );
  io.note(
    english
      ? 'Framework dependencies are included automatically; for example, Laravel includes PHP.'
      : 'Dependency framework disertakan otomatis; contohnya, Laravel menyertakan PHP.',
    english ? 'Automatic dependencies' : 'Dependency otomatis',
  );
  const initialStack =
    options.includeDetectedStack !== false && !usedPreset
      ? [...new Set([...config.stack, ...detection.stack])]
      : [...config.stack];
  const selectedStack = answer(
    await io.groupMultiselect({
      message: english ? 'Select project technologies' : 'Pilih teknologi proyek',
      options: stackOptions(config.language, initialStack),
      initialValues: resolveStack(initialStack).values,
      required: false,
      selectableGroups: false,
      groupSpacing: 1,
    }),
  );
  config.stack = resolveStack(selectedStack).values;
  io.note(
    formatStack(config.stack, config.language) ||
      (english ? 'No stack selected.' : 'Belum ada stack yang dipilih.'),
    english ? 'Selected stack' : 'Stack terpilih',
  );
  config.agents = answer(
    await io.multiselect({
      message: english ? 'Target agents' : 'Agent yang digunakan',
      options: agents.map((value) => ({ value, label: value })),
      initialValues: config.agents,
      required: true,
    }),
  );
  const initialSkills =
    options.recommendSkills && !usedPreset
      ? recommendedSkills(config.stack, detection.uiEvidence)
      : config.skills;
  config.skills = answer(
    await io.multiselect({
      message: english
        ? 'Project skills (engineering and optional workflows)'
        : 'Skill proyek (engineering dan alur opsional)',
      options: skillIds.map((value) => ({
        value,
        label: skillLabels[config.language][value],
        hint: rules[value][config.language],
      })),
      initialValues: initialSkills,
      required: true,
    }),
  );
  config.validation = answer(
    await io.select<Config['validation']>({
      message: english ? 'Validation policy' : 'Kebijakan pengujian',
      options: [
        { value: 'ask', label: english ? 'Ask permission first' : 'Minta izin dulu' },
        { value: 'auto', label: english ? 'Run relevant checks' : 'Otomatis relevan' },
      ],
      initialValue: config.validation,
    }),
  );
  config.git = answer(
    await io.select<Config['git']>({
      message: english ? 'Git workflow' : 'Workflow Git',
      options: [
        {
          value: 'existing',
          label: english ? 'Existing repository conventions' : 'Ikuti konvensi repository',
        },
        { value: 'feature-pr', label: english ? 'Feature branch → PR' : 'Branch fitur → PR' },
        {
          value: 'staging',
          label: english ? 'Feature branch → staging → main' : 'Branch fitur → staging → main',
        },
      ],
      initialValue: config.git,
    }),
  );
  config.skillCatalogRevision = SKILL_CATALOG_REVISION;
  return parseConfig(config);
}

export async function confirmWrite(language: Language, io: Prompts = prompts): Promise<boolean> {
  return answer(
    await io.confirm({
      message: language === 'en' ? 'Write these files?' : 'Tulis file-file ini?',
    }),
  );
}

export async function resolveConflict(
  file: string,
  language: Language,
  io: Prompts = prompts,
  mode: 'target' | 'stale' | 'orphan' | 'limit' | 'nested' = 'target',
): Promise<ConflictDecision> {
  const english = language === 'en';
  if (mode === 'nested') return 'cancel';
  const options =
    mode === 'stale'
      ? [
          {
            value: 'retain' as const,
            label: english ? 'Retain as a plain document' : 'Simpan sebagai dokumen biasa',
            hint: english
              ? 'Move the developer content to the retained/ folder and rebase local links.'
              : 'Pindahkan konten developer ke folder retained/ dan sesuaikan link lokal.',
          },
          {
            value: 'delete' as const,
            label: english ? 'Delete after backup' : 'Hapus setelah membuat backup',
            hint: english
              ? 'Back up the complete original before deleting it.'
              : 'Buat backup lengkap sebelum menghapus file.',
          },
          {
            value: 'skip' as const,
            label: english ? 'Keep and skip this file' : 'Pertahankan dan lewati file ini',
          },
          {
            value: 'cancel' as const,
            label: english ? 'Cancel everything' : 'Batalkan semua perubahan',
          },
        ]
      : [
          {
            value: 'skip' as const,
            label: english ? 'Keep and skip this file' : 'Pertahankan dan lewati file ini',
            hint: english
              ? 'Leave the existing content untouched and apply other safe changes.'
              : 'Jaga isi file tetap utuh dan terapkan perubahan aman lainnya.',
          },
          {
            value: 'replace' as const,
            label: english ? 'Back up, then replace' : 'Backup, lalu ganti',
            hint: english
              ? 'Store the original under .my-skill-gweh/backups before replacing it.'
              : 'Simpan file asli di .my-skill-gweh/backups sebelum menggantinya.',
          },
          {
            value: 'cancel' as const,
            label: english ? 'Cancel everything' : 'Batalkan semua perubahan',
          },
        ];
  const value = answer(
    await io.select<ConflictDecision>({
      message: english ? `Resolve ${file}` : `Atasi konflik ${file}`,
      options,
      initialValue: 'skip',
    }),
  );
  return value;
}

export async function resolveMergeHunk(
  hunk: { id: string; startLine: number; local: string; generated: string },
  index: number,
  count: number,
  language: Language,
  io: Prompts = prompts,
): Promise<MergeChoice | 'skip' | 'cancel'> {
  const english = language === 'en';
  return answer(
    await io.select<MergeChoice | 'skip' | 'cancel'>({
      message: english
        ? `Conflict ${index + 1}/${count}, around line ${hunk.startLine}`
        : `Konflik ${index + 1}/${count}, sekitar baris ${hunk.startLine}`,
      options: [
        {
          value: 'local',
          label: english ? 'Keep my project version' : 'Gunakan versi project saya',
          hint: english
            ? 'Use the existing local section.'
            : 'Gunakan bagian yang sudah ada di project.',
        },
        {
          value: 'generated',
          label: english ? 'Use the generated version' : 'Gunakan versi hasil generator',
          hint: english
            ? 'Use the updated generated section.'
            : 'Gunakan bagian hasil generate terbaru.',
        },
        {
          value: 'both',
          label: english
            ? 'Keep both (project, then generated)'
            : 'Gabungkan (project, lalu generator)',
          hint: english
            ? 'Place the existing section first, then the generated section.'
            : 'Letakkan bagian project lebih dahulu, lalu bagian hasil generator.',
        },
        {
          value: 'skip',
          label: english ? 'Keep this file unchanged' : 'Jaga file tetap utuh',
        },
        {
          value: 'cancel',
          label: english ? 'Cancel everything' : 'Batalkan semua perubahan',
        },
      ],
      initialValue: 'local',
    }),
  );
}
