import { createHash } from 'node:crypto';
import type { Document } from './render.js';

export const BEGIN_MARKER = '<!-- BEGIN my-skill-gweh -->';
export const END_MARKER = '<!-- END my-skill-gweh -->';

export function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

interface Replacement {
  content: string;
  fingerprint: string;
}

function ownedHash(block: string, header: string): string {
  return fingerprint(header ? `${header}\0${block}` : block);
}

/** Undefined means a conflict; never guess ownership from a filename alone. */
export function replaceManagedContent(
  original: string | undefined,
  document: Document,
  expectedHash: string | undefined,
): Replacement | undefined {
  const header = document.frontmatter ?? '';
  const block = `\n${document.body.trimEnd()}\n`;
  const wrapped = `${BEGIN_MARKER}${block}${END_MARKER}`;
  const nextHash = ownedHash(block, header);
  if (original === undefined) {
    return { content: `${header}${wrapped}\n`, fingerprint: nextHash };
  }

  const begin = original.indexOf(BEGIN_MARKER);
  const end = original.indexOf(END_MARKER);
  if (begin === -1 && end === -1) {
    if (!document.appendable || expectedHash !== undefined) return undefined;
    const separator = original && !original.endsWith('\n') ? '\n\n' : original ? '\n' : '';
    return { content: `${original}${separator}${wrapped}\n`, fingerprint: nextHash };
  }
  if (
    begin === -1 ||
    end < begin ||
    original.indexOf(BEGIN_MARKER, begin + BEGIN_MARKER.length) !== -1 ||
    original.indexOf(END_MARKER, end + END_MARKER.length) !== -1
  )
    return undefined;

  const prefix = original.slice(0, begin);
  const suffix = original.slice(end + END_MARKER.length);
  const previousBlock = original.slice(begin + BEGIN_MARKER.length, end);
  let previousHeader = '';
  if (header) {
    // Old versions put frontmatter inside the marker. Move it to byte zero
    // only after its legacy fingerprint has verified ownership.
    if (prefix) {
      if (!/^---\r?\n[\s\S]*?\r?\n---\r?\n$/u.test(prefix)) return undefined;
      previousHeader = prefix;
    }
  }
  if (ownedHash(previousBlock, previousHeader) !== expectedHash) return undefined;
  return {
    content: `${header || prefix}${wrapped}${suffix}`,
    fingerprint: nextHash,
  };
}
