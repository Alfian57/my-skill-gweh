import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isFileError, isRecord } from './errors.js';
import { readOptional } from './filesystem.js';
import { stackTechnologies, type StackTechnology } from './stack.js';

export interface Detection {
  stack: string[];
  evidence: string[];
  commands: Record<string, string>;
  ecosystems: string[];
  sourceEvidence: string[];
}

const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.next',
  'coverage',
]);

const sourceLanguages: Readonly<Record<string, StackTechnology>> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.php': 'php',
  '.go': 'go',
};

async function scanSources(
  root: string,
): Promise<{ languages: Set<StackTechnology>; extensions: Set<string> }> {
  const languages = new Set<StackTechnology>();
  const extensions = new Set<string>();
  const pending = [root];

  while (pending.length) {
    const directory = pending.pop();
    if (!directory) continue;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (
        directory !== root &&
        (isFileError(error, 'ENOENT') ||
          isFileError(error, 'EACCES') ||
          isFileError(error, 'EPERM'))
      ) {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name.toLowerCase())) {
          pending.push(path.join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      const language = sourceLanguages[extension];
      if (language) {
        languages.add(language);
        extensions.add(extension);
      }
    }
  }

  return { languages, extensions };
}

function stringMap(value: unknown, field: string, file: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid ${field} in ${file}: expected an object of strings.`);
  }
  return value as Record<string, string>;
}

function manifest(raw: string, file: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}`, { cause: error });
  }
  if (!isRecord(value)) throw new Error(`Invalid project manifest: ${file}`);
  return value;
}

export async function detect(root: string): Promise<Detection> {
  const stack = new Set<StackTechnology>();
  const evidence: string[] = [];
  const ecosystems: string[] = [];
  const sources = await scanSources(root);
  for (const language of sources.languages) stack.add(language);
  let commands: Record<string, string> = {};

  for (const filename of ['package.json', 'composer.json', 'go.mod']) {
    const file = path.join(root, filename);
    const raw = await readOptional(file);
    if (raw === undefined) continue;
    evidence.push(filename);

    if (filename === 'go.mod') {
      ecosystems.push('go-modules');
      const uncommented = raw.replace(/\/\/.*$/gmu, '');
      if (/^\s*(?:require\s+)?github\.com\/gin-gonic\/gin\s+v\S+/mu.test(uncommented))
        stack.add('gin');
      continue;
    }

    const data = manifest(raw, file);
    if (filename === 'package.json') {
      ecosystems.push('javascript-packages');
      const dependencies = {
        ...stringMap(data.dependencies, 'dependencies', file),
        ...stringMap(data.devDependencies, 'devDependencies', file),
      };
      for (const [dependency, name] of [
        ['react', 'react'],
        ['next', 'nextjs'],
        ['@inertiajs/react', 'inertia'],
      ] as const) {
        if (Object.hasOwn(dependencies, dependency)) stack.add(name);
      }
      commands = stringMap(data.scripts, 'scripts', file);
    } else {
      ecosystems.push('composer');
      const dependencies = {
        ...stringMap(data.require, 'require', file),
        ...stringMap(data['require-dev'], 'require-dev', file),
      };
      if (Object.hasOwn(dependencies, 'laravel/framework')) stack.add('laravel');
    }
  }

  return {
    stack: stackTechnologies.filter((technology) => stack.has(technology)),
    evidence,
    commands,
    ecosystems,
    sourceEvidence: [...sources.extensions].sort(),
  };
}
