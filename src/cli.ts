#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { readJson } from './filesystem.js';
import { CancelledError, errorMessage, isRecord } from './errors.js';
import { defaultContext, runCommand } from './cli/commands.js';
import { parseCommand } from './cli/options.js';

function describeError(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    messages.push(errorMessage(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return messages.join(': ');
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const metadata = await readJson(fileURLToPath(new URL('../package.json', import.meta.url)));
  if (!isRecord(metadata) || typeof metadata.version !== 'string') {
    throw new Error('Package version is missing.');
  }
  process.exitCode = await runCommand(command, defaultContext(metadata.version));
}

main().catch((error: unknown) => {
  console.error(describeError(error));
  process.exitCode = error instanceof CancelledError ? 130 : 1;
});
