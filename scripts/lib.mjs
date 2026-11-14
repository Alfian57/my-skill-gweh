import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = fileURLToPath(new URL('../', import.meta.url));

export async function packageMetadata(packageRoot = root) {
  return JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
}

export function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(
      `Command failed (${result.status ?? result.signal}): node ${args[0]}${details ? `\n${details}` : ''}`,
    );
  }
  return result.stdout;
}

/** npm_execpath is supplied by npm run and avoids invoking .cmd files via a shell on Windows. */
export function runNpm(args, options = {}) {
  if (!process.env.npm_execpath) throw new Error('Run this script through npm run.');
  return runNode([process.env.npm_execpath, ...args], options);
}
