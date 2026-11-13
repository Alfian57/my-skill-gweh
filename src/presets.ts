import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, type Config } from './config.js';
import { isFileError } from './errors.js';

export function presetDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  const configHome =
    environment.XDG_CONFIG_HOME ??
    (process.platform === 'win32'
      ? (environment.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
      : path.join(os.homedir(), '.config'));
  return path.join(configHome, 'my-skill-gweh', 'presets');
}

function presetFile(directory: string, name: string): string {
  if (!/^[a-z0-9-]+$/u.test(name))
    throw new Error('Preset name must contain lowercase letters, digits and hyphens.');
  return path.join(directory, `${name}.json`);
}

export async function listPresets(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^[a-z0-9-]+\.json$/u.test(entry.name))
      .map((entry) => entry.name.slice(0, -5))
      .sort();
  } catch (error) {
    if (isFileError(error, 'ENOENT')) return [];
    throw error;
  }
}

export async function showPreset(directory: string, name: string): Promise<Config> {
  return loadConfig(presetFile(directory, name));
}

export async function savePreset(directory: string, name: string, source: string): Promise<void> {
  const destination = presetFile(directory, name);
  const config = await loadConfig(source);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(destination, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
}

export async function removePreset(directory: string, name: string): Promise<void> {
  await fs.unlink(presetFile(directory, name));
}
