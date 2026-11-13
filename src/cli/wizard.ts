import * as prompts from '@clack/prompts';
import { agents, rules, skillIds, type Language } from '../catalog.js';
import { validateOutput, parseConfig, type Config } from '../config.js';
import { CancelledError, errorMessage } from '../errors.js';
import type { Detection } from '../detection.js';

export type Prompts = Pick<
  typeof prompts,
  'intro' | 'select' | 'text' | 'multiselect' | 'note' | 'confirm'
>;

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
  io.note(JSON.stringify(detection, null, 2), english ? 'Detected project' : 'Hasil deteksi');
  config.stack = answer(
    await io.text({
      message: english
        ? 'Stack (comma separated; edit detection)'
        : 'Stack (pisahkan koma; hasil deteksi bisa diubah)',
      defaultValue: config.stack.join(','),
      placeholder: detection.stack.join(',') || 'typescript,react,nextjs',
    }),
  )
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
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
