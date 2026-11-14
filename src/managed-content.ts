import { createHash } from 'node:crypto';
import * as commonmark from 'commonmark';
import type { Document } from './render.js';

export const BEGIN_MARKER = '<!-- BEGIN my-skill-gweh -->';
export const END_MARKER = '<!-- END my-skill-gweh -->';
const SIGNATURE = /^\r?\n<!-- my-skill-gweh-sha256:([a-f0-9]{64}) -->/u;
const parser = new commonmark.Parser();

function normalizeEol(value: string): string {
  return value.replace(/\r\n?/gu, '\n');
}

export function fingerprint(content: string): string {
  return createHash('sha256').update(normalizeEol(content)).digest('hex');
}

function ownedHash(block: string, header: string): string {
  return fingerprint(header ? `${header}\0${block}` : block);
}

function legacyRawHash(block: string, header: string): string {
  return createHash('sha256')
    .update(header ? `${header}\0${block}` : block)
    .digest('hex');
}

interface ParsedManagedContent {
  begin: number;
  end: number;
  prefix: string;
  suffix: string;
  payload: string;
  signature?: string;
  header: string;
}

function structuralMarkerPositions(content: string, marker: string): number[] {
  const lines = content.split(/\r\n|\n|\r/u);
  const codeLines = new Set<number>();
  const walker = parser.parse(content).walker();
  let step = walker.next();
  while (step) {
    const node = step.node;
    if (step.entering && node.type === 'code_block' && node.sourcepos) {
      const first = node.sourcepos[0][0];
      const last = node.sourcepos[1][0];
      for (let line = first; line <= last; line += 1) codeLines.add(line);
    }
    step = walker.next();
  }

  const positions: number[] = [];
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    if (!codeLines.has(index + 1) && line.trim() === marker) {
      positions.push(offset + line.indexOf(marker));
    }
    offset +=
      line.length +
      (content.slice(offset + line.length, offset + line.length + 2) === '\r\n' ? 2 : 1);
  }
  return positions;
}

/** True only for structural marker lines; examples inside Markdown code are ignored. */
export function containsManagedMarkers(content: string): boolean {
  return (
    structuralMarkerPositions(content, BEGIN_MARKER).length > 0 ||
    structuralMarkerPositions(content, END_MARKER).length > 0
  );
}

function parseManagedContent(original: string): ParsedManagedContent | undefined {
  const begins = structuralMarkerPositions(original, BEGIN_MARKER);
  const ends = structuralMarkerPositions(original, END_MARKER);
  const begin = begins[0] ?? -1;
  const end = ends.find((position) => position >= begin) ?? -1;
  if (begin === -1 || end < begin || begins.length !== 1 || ends.length !== 1) return undefined;

  const prefix = original.slice(0, begin);
  const inner = original.slice(begin + BEGIN_MARKER.length, end);
  const signature = SIGNATURE.exec(inner);
  const payload = signature ? inner.slice(signature[0].length) : inner;
  const header = /^---\r?\n[\s\S]*?\r?\n---\r?\n$/u.test(prefix) ? prefix : '';
  return {
    begin,
    end,
    prefix,
    suffix: original.slice(end + END_MARKER.length),
    payload,
    ...(signature?.[1] ? { signature: signature[1] } : {}),
    header,
  };
}

export function verifiedManagedFingerprint(original: string): string | undefined {
  const parsed = parseManagedContent(original);
  if (!parsed?.signature) return undefined;
  const actual = ownedHash(parsed.payload, parsed.header);
  return actual === parsed.signature ? actual : undefined;
}

/** Return only the signed generator body, excluding markers, signature, header and user suffix. */
export function managedPayload(original: string): string | undefined {
  const parsed = parseManagedContent(original);
  if (!parsed) return undefined;
  return normalizeEol(parsed.payload).replace(/^\n/u, '').replace(/\n$/u, '');
}

/** Keep the document body and developer text around it, but remove generator metadata. */
export function retainManagedContent(original: string): string {
  const parsed = parseManagedContent(original);
  if (!parsed) return original;
  const prefix = parsed.header ? parsed.prefix.slice(parsed.header.length) : parsed.prefix;
  const body = normalizeEol(parsed.payload)
    .replace(/^\n/u, '')
    .replace(/\n$/u, '')
    .replace(/^<!-- my-skill-gweh-sha256:[a-f0-9]{64} -->\n?/u, '');
  return `${prefix}${body}${normalizeEol(parsed.suffix)}`;
}

export function managedContentFingerprint(original: string): string | undefined {
  const parsed = parseManagedContent(original);
  return parsed ? ownedHash(parsed.payload, parsed.header) : undefined;
}

interface Replacement {
  content: string;
  fingerprint: string;
}

function eolOf(value: string): string {
  return value.includes('\r\n') ? '\r\n' : '\n';
}

function documentContent(document: Document, eol: string, hash: string): string {
  const body = normalizeEol(document.body).replace(/\n+$/u, '').replace(/\n/gu, eol);
  const block = `${eol}${body}${eol}`;
  const signature = `${eol}<!-- my-skill-gweh-sha256:${hash} -->`;
  const header = document.frontmatter
    ? normalizeEol(document.frontmatter).replace(/\n/gu, eol)
    : '';
  return `${header}${BEGIN_MARKER}${signature}${block}${END_MARKER}`;
}

/** Undefined means a conflict; never guess ownership from a filename alone. */
export function replaceManagedContent(
  original: string | undefined,
  document: Document,
  expectedHash: string | undefined,
  options: { force?: boolean } = {},
): Replacement | undefined {
  const header = document.frontmatter ?? '';
  const block = `\n${normalizeEol(document.body).replace(/\n+$/u, '')}\n`;
  const nextHash = ownedHash(block, header);
  if (original === undefined) {
    return { content: documentContent(document, '\n', nextHash) + '\n', fingerprint: nextHash };
  }

  const parsed = parseManagedContent(original);
  if (!parsed) {
    if (options.force) {
      return {
        content: documentContent(document, eolOf(original), nextHash) + eolOf(original),
        fingerprint: nextHash,
      };
    }
    if (containsManagedMarkers(original)) return undefined;
    if (!document.appendable || expectedHash !== undefined) return undefined;
    const eol = eolOf(original);
    const separator = original && !original.endsWith(eol) ? `${eol}${eol}` : original ? eol : '';
    const generated = documentContent(document, eol, nextHash);
    return { content: `${original}${separator}${generated}${eol}`, fingerprint: nextHash };
  }

  const matchesManifest =
    ownedHash(parsed.payload, parsed.header) === expectedHash ||
    legacyRawHash(parsed.payload, parsed.header) === expectedHash;
  const matchesSignature = parsed.signature === ownedHash(parsed.payload, parsed.header);
  if (!options.force && !matchesManifest && !matchesSignature) return undefined;

  if (options.force) {
    const eol = eolOf(original);
    if (header || parsed.header) {
      if (parsed.prefix && !parsed.header) {
        return { content: documentContent(document, eol, nextHash) + eol, fingerprint: nextHash };
      }
      const effectiveHeader = header || parsed.header;
      const effectiveHash = ownedHash(block, effectiveHeader);
      const replacement = documentContent(
        { ...document, frontmatter: effectiveHeader },
        eol,
        effectiveHash,
      );
      const normalizedHeader = effectiveHeader
        ? normalizeEol(effectiveHeader).replace(/\n/gu, eol)
        : '';
      return {
        content: `${normalizedHeader}${replacement.slice(normalizedHeader.length)}${parsed.suffix}`,
        fingerprint: effectiveHash,
      };
    }
    const replacement = documentContent(document, eol, nextHash);
    return {
      content: `${parsed.prefix}${replacement.slice(0, replacement.indexOf(BEGIN_MARKER))}${replacement.slice(replacement.indexOf(BEGIN_MARKER))}${parsed.suffix}`,
      fingerprint: nextHash,
    };
  }
  if (header && parsed.prefix && !parsed.header) return undefined;
  const replacement = documentContent(document, eolOf(original), nextHash);
  const normalizedHeader = header ? normalizeEol(header).replace(/\n/gu, eolOf(original)) : '';
  const headerLength = normalizedHeader.length;
  const managed = replacement.slice(headerLength);
  return {
    content: `${normalizedHeader || parsed.prefix}${managed}${parsed.suffix}`,
    fingerprint: nextHash,
  };
}

export function removeManagedContent(
  original: string,
  expectedHash: string,
  options: { force?: boolean } = {},
): { content: string | undefined; fingerprint: string } | undefined {
  const parsed = parseManagedContent(original);
  if (!parsed) return undefined;
  const actual = ownedHash(parsed.payload, parsed.header);
  if (
    !options.force &&
    actual !== expectedHash &&
    legacyRawHash(parsed.payload, parsed.header) !== expectedHash &&
    parsed.signature !== actual
  )
    return undefined;

  let prefix = parsed.prefix;
  if (parsed.header) prefix = prefix.slice(parsed.header.length);
  const remaining = `${prefix}${parsed.suffix}`;
  if (!remaining.trim()) return { content: undefined, fingerprint: actual };
  return { content: remaining, fingerprint: actual };
}
