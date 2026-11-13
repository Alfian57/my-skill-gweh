import { createHash } from 'node:crypto';

interface Edit {
  start: number;
  end: number;
  lines: string[];
}

export type MergeChoice = 'local' | 'generated' | 'both';

export interface MergeHunk {
  id: string;
  startLine: number;
  base: string;
  local: string;
  generated: string;
  baseLines: string[];
  localLines: string[];
  generatedLines: string[];
  contextBefore: string;
  contextAfter: string;
}

export type MergePart = { kind: 'text'; lines: string[] } | { kind: 'conflict'; hunk: MergeHunk };

export type ThreeWayMerge =
  | { kind: 'merged'; text: string }
  | { kind: 'conflicts'; parts: MergePart[]; hunks: MergeHunk[] }
  | { kind: 'limit'; baseLines: number; localLines: number; generatedLines: number };

function edits(base: string[], variant: string[]): Edit[] | undefined {
  const rows = base.length + 1;
  const columns = variant.length + 1;
  if (rows * columns > 2_000_000) return undefined;
  const table = new Uint32Array(rows * columns);
  const at = (row: number, column: number): number => row * columns + column;
  for (let row = base.length - 1; row >= 0; row -= 1) {
    for (let column = variant.length - 1; column >= 0; column -= 1) {
      table[at(row, column)] =
        base[row] === variant[column]
          ? (table[at(row + 1, column + 1)] ?? 0) + 1
          : Math.max(table[at(row + 1, column)] ?? 0, table[at(row, column + 1)] ?? 0);
    }
  }

  const result: Edit[] = [];
  let row = 0;
  let column = 0;
  let pending: Edit | undefined;
  const flush = (): void => {
    if (pending) result.push(pending);
    pending = undefined;
  };
  while (row < base.length || column < variant.length) {
    if (row < base.length && column < variant.length && base[row] === variant[column]) {
      flush();
      row += 1;
      column += 1;
      continue;
    }
    pending ??= { start: row, end: row, lines: [] };
    if (
      row < base.length &&
      (column >= variant.length ||
        (table[at(row + 1, column)] ?? 0) >= (table[at(row, column + 1)] ?? 0))
    ) {
      row += 1;
      pending.end = row;
    } else {
      pending.lines.push(variant[column] ?? '');
      column += 1;
    }
  }
  flush();
  return result;
}

function intersects(left: Edit, right: Edit): boolean {
  if (left.start === left.end && right.start === right.end) return left.start === right.start;
  if (left.start === left.end) return left.start > right.start && left.start < right.end;
  if (right.start === right.end) return right.start > left.start && right.start < left.end;
  return left.start < right.end && right.start < left.end;
}

function applyEdits(base: string[], start: number, end: number, changes: Edit[]): string[] {
  const result: string[] = [];
  let cursor = start;
  for (const edit of [...changes].sort((left, right) => left.start - right.start)) {
    result.push(...base.slice(cursor, edit.start), ...edit.lines);
    cursor = edit.end;
  }
  result.push(...base.slice(cursor, end));
  return result;
}

interface ConflictGroup {
  start: number;
  end: number;
  local: Edit[];
  generated: Edit[];
}

function conflictGroups(local: Edit[], generated: Edit[]): ConflictGroup[] {
  const visitedLocal = new Set<number>();
  const visitedGenerated = new Set<number>();
  const groups: ConflictGroup[] = [];

  for (let startIndex = 0; startIndex < local.length; startIndex += 1) {
    if (
      visitedLocal.has(startIndex) ||
      !generated.some((edit) => intersects(local[startIndex]!, edit))
    )
      continue;
    const localIndexes = new Set<number>([startIndex]);
    const generatedIndexes = new Set<number>();
    const queue: Array<{ side: 'local' | 'generated'; index: number }> = [
      { side: 'local', index: startIndex },
    ];
    while (queue.length) {
      const item = queue.pop();
      if (!item) continue;
      if (item.side === 'local') {
        const edit = local[item.index];
        if (!edit) continue;
        generated.forEach((candidate, index) => {
          if (!generatedIndexes.has(index) && intersects(edit, candidate)) {
            generatedIndexes.add(index);
            queue.push({ side: 'generated', index });
          }
        });
      } else {
        const edit = generated[item.index];
        if (!edit) continue;
        local.forEach((candidate, index) => {
          if (!localIndexes.has(index) && intersects(edit, candidate)) {
            localIndexes.add(index);
            queue.push({ side: 'local', index });
          }
        });
      }
    }
    for (const index of localIndexes) visitedLocal.add(index);
    for (const index of generatedIndexes) visitedGenerated.add(index);
    const localEdits = [...localIndexes].map((index) => local[index]!);
    const generatedEdits = [...generatedIndexes].map((index) => generated[index]!);
    const all = [...localEdits, ...generatedEdits];
    groups.push({
      start: all.reduce((lowest, edit) => Math.min(lowest, edit.start), Number.POSITIVE_INFINITY),
      end: all.reduce((highest, edit) => Math.max(highest, edit.end), 0),
      local: localEdits,
      generated: generatedEdits,
    });
  }
  return groups.sort((left, right) => left.start - right.start || left.end - right.end);
}

function equalLines(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function hunkId(start: number, base: string, local: string, generated: string): string {
  const digest = createHash('sha256')
    .update(`${start}\0${base}\0${local}\0${generated}`)
    .digest('hex')
    .slice(0, 16);
  return `h${start + 1}-${digest}`;
}

/** Analyze line edits and return clean regions alongside each independently resolvable conflict. */
export function mergeTextThreeWayDetailed(
  baseText: string,
  localText: string,
  generatedText: string,
): ThreeWayMerge {
  const baseNormalized = baseText.replace(/\r\n?/gu, '\n');
  const localNormalized = localText.replace(/\r\n?/gu, '\n');
  const generatedNormalized = generatedText.replace(/\r\n?/gu, '\n');
  if (generatedNormalized === baseNormalized) return { kind: 'merged', text: localNormalized };
  if (localNormalized === baseNormalized || localNormalized === generatedNormalized)
    return { kind: 'merged', text: generatedNormalized };

  const base = baseNormalized.split('\n');
  const localEdits = edits(base, localNormalized.split('\n'));
  const generatedEdits = edits(base, generatedNormalized.split('\n'));
  if (!localEdits || !generatedEdits) {
    return {
      kind: 'limit',
      baseLines: base.length,
      localLines: localNormalized.split('\n').length,
      generatedLines: generatedNormalized.split('\n').length,
    };
  }

  const groups = conflictGroups(localEdits, generatedEdits);
  const localConflictEdits = new Set(groups.flatMap(({ local }) => local));
  const generatedConflictEdits = new Set(groups.flatMap(({ generated }) => generated));
  const events: Array<{ start: number; end: number; lines?: string[]; hunk?: MergeHunk }> = [];
  for (const group of groups) {
    const localLines = applyEdits(base, group.start, group.end, group.local);
    const generatedLines = applyEdits(base, group.start, group.end, group.generated);
    if (equalLines(localLines, generatedLines)) {
      events.push({ start: group.start, end: group.end, lines: localLines });
      continue;
    }
    const baseLines = base.slice(group.start, group.end);
    const body = {
      base: baseLines.join('\n'),
      local: localLines.join('\n'),
      generated: generatedLines.join('\n'),
      baseLines,
      localLines,
      generatedLines,
    };
    const hunk: MergeHunk = {
      id: hunkId(group.start, body.base, body.local, body.generated),
      startLine: group.start + 1,
      ...body,
      contextBefore: base.slice(Math.max(0, group.start - 2), group.start).join('\n'),
      contextAfter: base.slice(group.end, Math.min(base.length, group.end + 2)).join('\n'),
    };
    events.push({ start: group.start, end: group.end, hunk });
  }
  localEdits.forEach((edit) => {
    if (!localConflictEdits.has(edit))
      events.push({ start: edit.start, end: edit.end, lines: edit.lines });
  });
  generatedEdits.forEach((edit) => {
    if (!generatedConflictEdits.has(edit))
      events.push({ start: edit.start, end: edit.end, lines: edit.lines });
  });
  events.sort((left, right) => left.start - right.start || left.end - right.end);

  const parts: MergePart[] = [];
  let cursor = 0;
  for (const event of events) {
    if (event.start < cursor) {
      return {
        kind: 'limit',
        baseLines: base.length,
        localLines: localNormalized.split('\n').length,
        generatedLines: generatedNormalized.split('\n').length,
      };
    }
    const unchanged = base.slice(cursor, event.start);
    if (unchanged.length) parts.push({ kind: 'text', lines: unchanged });
    if (event.hunk) parts.push({ kind: 'conflict', hunk: event.hunk });
    else if (event.lines?.length) parts.push({ kind: 'text', lines: event.lines });
    cursor = event.end;
  }
  const unchanged = base.slice(cursor);
  if (unchanged.length) parts.push({ kind: 'text', lines: unchanged });
  const hunks = parts.flatMap((part) => (part.kind === 'conflict' ? [part.hunk] : []));
  if (!hunks.length)
    return {
      kind: 'merged',
      text: parts.flatMap((part) => (part.kind === 'text' ? part.lines : [])).join('\n'),
    };
  return { kind: 'conflicts', parts, hunks };
}

export function resolveThreeWayMerge(
  merge: Extract<ThreeWayMerge, { kind: 'conflicts' }>,
  choices: Record<string, MergeChoice>,
): string | undefined {
  const output: string[] = [];
  for (const part of merge.parts) {
    if (part.kind === 'text') {
      output.push(...part.lines);
      continue;
    }
    const choice = choices[part.hunk.id];
    if (!choice) return undefined;
    if (choice === 'local') output.push(...part.hunk.localLines);
    else if (choice === 'generated') output.push(...part.hunk.generatedLines);
    else {
      const local = [...part.hunk.localLines];
      const generated = [...part.hunk.generatedLines];
      while (local.at(-1) === '') local.pop();
      while (generated[0] === '') generated.shift();
      if (local.length && generated.length) output.push(...local, '', ...generated);
      else output.push(...local, ...generated);
    }
  }
  return output.join('\n');
}

/** Backward-compatible helper: return undefined for an unresolved hunk or safe work limit. */
export function mergeTextThreeWay(
  baseText: string,
  localText: string,
  generatedText: string,
): string | undefined {
  const result = mergeTextThreeWayDetailed(baseText, localText, generatedText);
  return result.kind === 'merged' ? result.text : undefined;
}
