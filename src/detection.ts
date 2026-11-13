import path from 'node:path';
import { isRecord } from './errors.js';
import { readOptional } from './filesystem.js';

export interface Detection {
  stack: string[];
  evidence: string[];
  commands: Record<string, string>;
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
  const stack = new Set<string>();
  const evidence: string[] = [];
  let commands: Record<string, string> = {};

  for (const filename of ['package.json', 'composer.json', 'go.mod']) {
    const file = path.join(root, filename);
    const raw = await readOptional(file);
    if (raw === undefined) continue;
    evidence.push(filename);

    if (filename === 'go.mod') {
      stack.add('go');
      const uncommented = raw.replace(/\/\/.*$/gmu, '');
      if (/^\s*(?:require\s+)?github\.com\/gin-gonic\/gin\s+v\S+/mu.test(uncommented))
        stack.add('gin');
      continue;
    }

    const data = manifest(raw, file);
    if (filename === 'package.json') {
      stack.add('javascript');
      const dependencies = {
        ...stringMap(data.dependencies, 'dependencies', file),
        ...stringMap(data.devDependencies, 'devDependencies', file),
      };
      for (const [dependency, name] of [
        ['typescript', 'typescript'],
        ['react', 'react'],
        ['next', 'nextjs'],
        ['@inertiajs/react', 'inertia'],
      ] as const) {
        if (Object.hasOwn(dependencies, dependency)) stack.add(name);
      }
      commands = stringMap(data.scripts, 'scripts', file);
    } else {
      stack.add('php');
      const dependencies = {
        ...stringMap(data.require, 'require', file),
        ...stringMap(data['require-dev'], 'require-dev', file),
      };
      if (Object.hasOwn(dependencies, 'laravel/framework')) stack.add('laravel');
    }
  }

  return { stack: [...stack], evidence, commands };
}
