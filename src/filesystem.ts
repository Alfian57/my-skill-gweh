import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isFileError } from './errors.js';

export async function readJson(file: string): Promise<unknown> {
  const text = await fs.readFile(file, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${file}`, { cause: error });
  }
}

export async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (isFileError(error, 'ENOENT')) return undefined;
    throw error;
  }
}

export function safe(root: string, relative: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  const location = path.relative(base, target);
  if (
    !location ||
    location === '..' ||
    location.startsWith(`..${path.sep}`) ||
    path.isAbsolute(location)
  ) {
    throw new Error(`Path must remain inside target: ${relative}`);
  }
  return target;
}

export async function projectRoot(root: string): Promise<string> {
  const resolved = await fs.realpath(root);
  if (!(await fs.stat(resolved)).isDirectory()) throw new Error(`Not a project directory: ${root}`);
  return resolved;
}

/** Reject symlinks in every existing component, including the destination itself. */
export async function assertSafePath(root: string, relative: string): Promise<string> {
  const target = safe(root, relative);
  const parts = path.relative(root, target).split(path.sep);
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in managed path: ${current}`);
      if (index < parts.length - 1 && !stat.isDirectory()) {
        throw new Error(`Expected a directory in managed path: ${current}`);
      }
      if (index === parts.length - 1 && !stat.isFile()) {
        throw new Error(`Expected a regular file: ${current}`);
      }
    } catch (error) {
      if (isFileError(error, 'ENOENT')) break;
      throw error;
    }
  }
  return target;
}
