import * as commonmark from 'commonmark';
import path from 'node:path';
import { safe } from './filesystem.js';

const parser = new commonmark.Parser();

interface DestinationRange {
  start: number;
  end: number;
  value: string;
}

function localPath(destination: string): { path: string; suffix: string } | undefined {
  if (
    !destination ||
    destination.startsWith('#') ||
    destination.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/iu.test(destination)
  )
    return undefined;
  const separator = destination.search(/[?#]/u);
  return separator < 0
    ? { path: destination, suffix: '' }
    : { path: destination.slice(0, separator), suffix: destination.slice(separator) };
}

function nodes(root: commonmark.Node): commonmark.Node[] {
  const found: commonmark.Node[] = [];
  const walker = root.walker();
  let step = walker.next();
  while (step) {
    if (step.entering && (step.node.type === 'link' || step.node.type === 'image'))
      found.push(step.node);
    step = walker.next();
  }
  return found;
}

/** Extract local CommonMark links outside code, comments, and other non-link text. */
export function localMarkdownTargets(content: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const node of nodes(parser.parse(content))) {
    const destination = node.destination;
    if (destination && localPath(destination) && !seen.has(destination)) {
      seen.add(destination);
      result.push(destination);
    }
  }
  return result;
}

function escaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1)
    backslashes += 1;
  return backslashes % 2 === 1;
}

function maskNonMarkdown(source: string): boolean[] {
  const mask = Array.from({ length: source.length }, () => true);
  let offset = 0;
  let fence: { marker: '`' | '~'; length: number } | undefined;
  for (const line of source.split('\n')) {
    const lineEnd = offset + line.length;
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence) {
      for (let index = offset; index < lineEnd; index += 1) mask[index] = false;
      const closing = marker?.[0] === fence.marker && marker.length >= fence.length;
      if (
        closing &&
        new RegExp(`^ {0,3}${fence.marker === '`' ? '`' : '~'}{${fence.length},}\\s*$`, 'u').test(
          line,
        )
      )
        fence = undefined;
    } else if (marker) {
      fence = { marker: marker[0] as '`' | '~', length: marker.length };
      for (let index = offset; index < lineEnd; index += 1) mask[index] = false;
    } else if (/^(?: {4,}|\t)/u.test(line)) {
      for (let index = offset; index < lineEnd; index += 1) mask[index] = false;
    }
    offset = lineEnd + 1;
  }

  for (let index = 0; index < source.length; index += 1) {
    if (!mask[index] || escaped(source, index)) continue;
    if (source.startsWith('<!--', index)) {
      const close = source.indexOf('-->', index + 4);
      const end = close < 0 ? source.length : close + 3;
      for (let cursor = index; cursor < end; cursor += 1) mask[cursor] = false;
      index = end - 1;
      continue;
    }
    if (source[index] !== '`') continue;
    let runEnd = index + 1;
    while (source[runEnd] === '`') runEnd += 1;
    const marker = source.slice(index, runEnd);
    let close = source.indexOf(marker, runEnd);
    while (close >= 0 && source[close - 1] === '`')
      close = source.indexOf(marker, close + marker.length);
    if (close < 0) continue;
    for (let cursor = index; cursor < close + marker.length; cursor += 1) mask[cursor] = false;
    index = close + marker.length - 1;
  }
  return mask;
}

function closingBracket(source: string, mask: boolean[], start: number): number | undefined {
  let depth = 1;
  for (let index = start + 1; index < source.length; index += 1) {
    if (!mask[index] || escaped(source, index)) continue;
    if (source[index] === '[') depth += 1;
    else if (source[index] === ']') {
      depth -= 1;
      if (!depth) return index;
    }
  }
  return undefined;
}

function inlineDestinations(source: string, mask: boolean[]): DestinationRange[] {
  const result: DestinationRange[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '[' || !mask[index] || escaped(source, index)) continue;
    const labelEnd = closingBracket(source, mask, index);
    if (labelEnd === undefined) continue;
    let cursor = labelEnd + 1;
    while (/\s/u.test(source[cursor] ?? '') && mask[cursor]) cursor += 1;
    if (source[cursor] !== '(' || !mask[cursor]) {
      index = labelEnd;
      continue;
    }
    cursor += 1;
    while (/\s/u.test(source[cursor] ?? '') && mask[cursor]) cursor += 1;
    if (source[cursor] === '<') {
      const start = ++cursor;
      while (cursor < source.length && (source[cursor] !== '>' || escaped(source, cursor)))
        cursor += 1;
      if (cursor < source.length)
        result.push({ start, end: cursor, value: source.slice(start, cursor) });
    } else {
      const start = cursor;
      let depth = 0;
      while (cursor < source.length) {
        if (!mask[cursor]) break;
        const character = source[cursor];
        if (escaped(source, cursor)) {
          cursor += 1;
          continue;
        }
        if (/\s/u.test(character ?? '')) break;
        if (character === '(') depth += 1;
        else if (character === ')') {
          if (!depth) break;
          depth -= 1;
        }
        cursor += 1;
      }
      if (cursor > start) result.push({ start, end: cursor, value: source.slice(start, cursor) });
    }
    index = labelEnd;
  }
  return result;
}

function decoded(value: string): string {
  const unescaped = value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, '$1');
  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped;
  }
}

function sameDestination(left: string, right: string): boolean {
  return left === right || decoded(left) === decoded(right);
}

function encodeDestination(destination: string): string {
  return destination
    .split('/')
    .map((part) =>
      part === '.' || part === '..'
        ? part
        : encodeURIComponent(part).replace(/%3A/giu, ':').replace(/%40/giu, '@'),
    )
    .join('/');
}

function referenceDefinitionRanges(source: string, mask: boolean[]): DestinationRange[] {
  const result: DestinationRange[] = [];
  let offset = 0;
  for (const line of source.split('\n')) {
    const match = /^ {0,3}\[[^\]\n]+\]:\s*(?:<([^>\n]*)>|(\S+))/u.exec(line);
    if (match) {
      const value = match[1] ?? match[2] ?? '';
      const relative =
        match[1] !== undefined ? match[0].indexOf(`<${value}>`) + 1 : match[0].lastIndexOf(value);
      const start = offset + relative;
      if (value && mask.slice(start, start + value.length).some(Boolean))
        result.push({ start, end: start + value.length, value });
    }
    offset += line.length + 1;
  }
  return result;
}

/** Rebase local links in a retained document after moving it to another project path. */
export function relocateMarkdownLinks(
  content: string,
  root: string,
  fromFile: string,
  toFile: string,
): string {
  content = content.replace(/\r\n?/gu, '\n');
  const mask = maskNonMarkdown(content);
  const candidates = inlineDestinations(content, mask);
  const linkNodes = nodes(parser.parse(content));
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const matchedCandidates = new Set<number>();
  const unresolved: commonmark.Node[] = [];

  for (const node of linkNodes) {
    const destination = node.destination;
    if (!destination || !localPath(destination)) continue;
    const candidateIndex = candidates.findIndex(
      (candidate, index) =>
        !matchedCandidates.has(index) && sameDestination(candidate.value, destination),
    );
    if (candidateIndex < 0) unresolved.push(node);
    else matchedCandidates.add(candidateIndex);
  }

  const references = referenceDefinitionRanges(content, mask);
  const usedReferences = new Set<number>();
  for (const node of unresolved) {
    const destination = node.destination;
    if (!destination || !localPath(destination)) continue;
    const definitionIndex = references.findIndex(
      (reference, index) =>
        !usedReferences.has(index) && sameDestination(reference.value, destination),
    );
    if (definitionIndex >= 0) usedReferences.add(definitionIndex);
  }

  const sourceDirectory = path.posix.dirname(fromFile);
  const destinationDirectory = path.posix.dirname(toFile);
  const rebase = (destination: string, range: DestinationRange): void => {
    const local = localPath(destination);
    if (!local || !local.path) return;
    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(local.path);
    } catch {
      decodedPath = local.path;
    }
    const target = path.posix.normalize(path.posix.join(sourceDirectory, decodedPath));
    try {
      safe(root, target);
    } catch {
      return;
    }
    const newRelative =
      path.posix.relative(destinationDirectory, target) || path.posix.basename(target);
    const rewritten = `${encodeDestination(newRelative)}${local.suffix}`;
    if (rewritten !== range.value)
      replacements.push({ start: range.start, end: range.end, text: rewritten });
  };

  for (let index = 0; index < candidates.length; index += 1) {
    if (!matchedCandidates.has(index)) continue;
    const candidate = candidates[index];
    if (!candidate) continue;
    const node = linkNodes.find(
      (item) => item.destination && sameDestination(candidate.value, item.destination),
    );
    if (node?.destination) rebase(node.destination, candidate);
  }
  for (const index of usedReferences) {
    const reference = references[index];
    const node = unresolved.find(
      (item) => item.destination && reference && sameDestination(reference.value, item.destination),
    );
    if (reference && node?.destination) rebase(node.destination, reference);
  }

  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    content = `${content.slice(0, replacement.start)}${replacement.text}${content.slice(replacement.end)}`;
  }
  return content;
}
