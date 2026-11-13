import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

export async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'my-skill-gweh-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

export async function writeJson(directory, relative, value) {
  const file = path.join(directory, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
}

export function runCli(directory, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, XDG_CONFIG_HOME: path.join(directory, 'isolated-config') },
  });
}

export async function snapshot(directory) {
  const result = {};
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) {
      for (const [name, content] of Object.entries(await snapshot(file))) {
        result[`${item.name}/${name}`] = content;
      }
    } else if (!item.isSymbolicLink()) {
      result[item.name] = await fs.readFile(file, 'utf8');
    }
  }
  return result;
}
