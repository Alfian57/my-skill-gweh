import path from 'node:path';
import {
  agents,
  rules,
  SKILL_CATALOG_REVISION,
  type Agent,
  type Language,
  type Skill,
} from './catalog.js';
import { isRecord } from './errors.js';
import { readJson } from './filesystem.js';

export const STATE_DIRECTORY = '.my-skill-gweh';
export const CONFIG_PATH = `${STATE_DIRECTORY}/config.json`;
export const MANIFEST_PATH = `${STATE_DIRECTORY}/manifest.json`;
export const BASELINE_PATH = `${STATE_DIRECTORY}/baselines.json`;

export interface Config {
  version: 1;
  language: Language;
  docsLanguage: Language;
  output: string;
  agents: Agent[];
  skills: Skill[];
  validation: 'ask' | 'auto';
  git: 'existing' | 'feature-pr' | 'staging';
  stack: string[];
  skillCatalogRevision?: number;
}

export function defaults(): Config {
  return {
    version: 1,
    language: 'id',
    docsLanguage: 'en',
    output: 'ai-agent-docs',
    agents: [...agents],
    skills: ['quality', 'docs', 'contracts', 'testing', 'dependencies'],
    validation: 'ask',
    git: 'existing',
    stack: [],
    skillCatalogRevision: SKILL_CATALOG_REVISION,
  };
}

function stringList(value: unknown, field: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`Configuration ${field} must be ${allowEmpty ? 'an' : 'a non-empty'} array.`);
  }
  if (
    value.some(
      (item: unknown) => typeof item !== 'string' || !item.trim() || /[\r\n\0<>]/u.test(item),
    )
  ) {
    throw new Error(`Configuration ${field} must contain non-empty single-line strings.`);
  }
  const result = value as string[];
  if (new Set(result).size !== result.length) {
    throw new Error(`Configuration ${field} contains duplicates.`);
  }
  return result;
}

export function validateOutput(output: unknown): asserts output is string {
  if (typeof output !== 'string' || !output.trim() || output !== output.trim()) {
    throw new Error('Configuration output must be a non-empty relative folder.');
  }
  const segments = output.split('/');
  if (
    path.posix.isAbsolute(output) ||
    /[\\:\x00-\x1f<>"|?*]/u.test(output) ||
    segments.some(
      (segment) =>
        !segment ||
        /[. ]$/u.test(segment) ||
        ['.', '..', '.git', STATE_DIRECTORY, '.my-skill-gweh.lock'].includes(
          segment.toLowerCase(),
        ) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment),
    )
  ) {
    throw new Error(
      'Configuration output must use a relative path with / separators, without traversal or reserved folders.',
    );
  }
}

export function validate(value: unknown): asserts value is Config {
  if (!isRecord(value)) throw new Error('Configuration must be a JSON object.');
  const allowed = new Set([...Object.keys(defaults()), 'customSkills']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unknown configuration field: ${key}`);
  }
  if (value.version !== 1) throw new Error('Unsupported configuration version; expected 1.');
  for (const key of ['language', 'docsLanguage'] as const) {
    if (value[key] !== 'id' && value[key] !== 'en')
      throw new Error(`Configuration ${key} must be id or en.`);
  }
  if (value.validation !== 'ask' && value.validation !== 'auto') {
    throw new Error('Configuration validation must be ask or auto.');
  }
  if (typeof value.git !== 'string' || !['existing', 'feature-pr', 'staging'].includes(value.git)) {
    throw new Error('Configuration git must be existing, feature-pr or staging.');
  }
  validateOutput(value.output);
  for (const agent of stringList(value.agents, 'agents')) {
    if (!(agents as readonly string[]).includes(agent)) throw new Error(`Unknown agent: ${agent}`);
  }
  for (const skill of stringList(value.skills, 'skills')) {
    if (!Object.hasOwn(rules, skill)) throw new Error(`Unknown skill: ${skill}`);
  }
  stringList(value.stack, 'stack', true);
  if (
    value.skillCatalogRevision !== undefined &&
    (!Number.isSafeInteger(value.skillCatalogRevision) ||
      (value.skillCatalogRevision as number) < 0 ||
      (value.skillCatalogRevision as number) > SKILL_CATALOG_REVISION)
  ) {
    throw new Error(
      `Configuration skillCatalogRevision must be an integer from 0 to ${SKILL_CATALOG_REVISION}.`,
    );
  }
  if (
    value.customSkills !== undefined &&
    (!Array.isArray(value.customSkills) || value.customSkills.length > 0)
  ) {
    throw new Error('Custom skill imports are not supported yet.');
  }
}

export function parseConfig(value: unknown): Config {
  validate(value);
  return {
    version: value.version,
    language: value.language,
    docsLanguage: value.docsLanguage,
    output: value.output,
    agents: [...value.agents],
    skills: [...value.skills],
    validation: value.validation,
    git: value.git,
    stack: [...value.stack],
    ...(typeof value.skillCatalogRevision === 'number'
      ? { skillCatalogRevision: value.skillCatalogRevision }
      : {}),
  };
}

export async function loadConfig(file: string): Promise<Config> {
  try {
    return parseConfig(await readJson(file));
  } catch (error) {
    throw new Error(`Cannot load configuration ${file}`, { cause: error });
  }
}
