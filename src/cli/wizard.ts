import * as prompts from '@clack/prompts';
import { agents, rules, skillIds, type Language } from '../catalog.js';
import { validateOutput, parseConfig, type Config } from '../config.js';
import { CancelledError, errorMessage } from '../errors.js';
import type { Detection } from '../detection.js';
import {
  formatStack,
  resolveStack,
  stackCatalog,
  type StackCategory,
  type StackTechnology,
} from '../stack.js';

export type Prompts = Pick<
  typeof prompts,
  'intro' | 'select' | 'text' | 'multiselect' | 'groupMultiselect' | 'note' | 'confirm'
>;

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
): Promise<Config> {
  const config = parseConfig(initial);
  io.intro('My Skill Gweh');
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
  const initialStack = [...new Set([...config.stack, ...detection.stack])];
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
  config.skills = answer(
    await io.multiselect({
      message: english
        ? 'Engineering skills (strict rules are opt-in)'
        : 'Skill engineering (aturan ketat opsional)',
      options: skillIds.map((value) => ({
        value,
        label: value,
        hint: rules[value][config.language],
      })),
      initialValues: config.skills,
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
      message: 'Git workflow',
      options: [
        {
          value: 'existing',
          label: english ? 'Existing repository conventions' : 'Ikuti konvensi repository',
        },
        { value: 'feature-pr', label: 'Feature branch → PR' },
        { value: 'staging', label: 'Feature branch → staging → main' },
      ],
      initialValue: config.git,
    }),
  );
  return parseConfig(config);
}

export async function confirmWrite(language: Language, io: Prompts = prompts): Promise<boolean> {
  return answer(
    await io.confirm({
      message: language === 'en' ? 'Write these files?' : 'Tulis file-file ini?',
    }),
  );
}
