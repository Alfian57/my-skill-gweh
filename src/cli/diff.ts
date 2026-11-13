interface DiffLine {
  kind: ' ' | '+' | '-';
  text: string;
}

/** A bounded line diff for interactive conflict review; large files are never shown as a fake diff. */
export function unifiedDiff(
  existing: string | undefined,
  proposed: string | undefined,
  contextLines = 3,
): string {
  const before = (existing ?? '(file does not exist)').replace(/\r\n?/gu, '\n').split('\n');
  const after = (proposed ?? '(generator will remove this managed output)')
    .replace(/\r\n?/gu, '\n')
    .split('\n');
  if (before.length * after.length > 1_000_000) {
    return `Diff omitted: file is too large for the interactive preview (${before.length} and ${after.length} lines).`;
  }
  const columns = after.length + 1;
  const table = new Uint32Array((before.length + 1) * columns);
  const at = (row: number, column: number): number => row * columns + column;
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      table[at(row, column)] =
        before[row] === after[column]
          ? (table[at(row + 1, column + 1)] ?? 0) + 1
          : Math.max(table[at(row + 1, column)] ?? 0, table[at(row, column + 1)] ?? 0);
    }
  }

  const diff: DiffLine[] = [];
  let row = 0;
  let column = 0;
  while (row < before.length || column < after.length) {
    if (row < before.length && column < after.length && before[row] === after[column]) {
      diff.push({ kind: ' ', text: before[row++]! });
      column += 1;
    } else if (
      row < before.length &&
      (column >= after.length ||
        (table[at(row + 1, column)] ?? 0) >= (table[at(row, column + 1)] ?? 0))
    ) {
      diff.push({ kind: '-', text: before[row++]! });
    } else {
      diff.push({ kind: '+', text: after[column++]! });
    }
  }

  const changed = diff.flatMap((line, index) => (line.kind === ' ' ? [] : [index]));
  if (!changed.length) return '(no content differences)';
  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changed) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(diff.length, index + contextLines + 1);
    const last = ranges.at(-1);
    if (last && start <= last.end) last.end = end;
    else ranges.push({ start, end });
  }

  const output: string[] = ['--- current', '+++ proposed'];
  let oldLine = 1;
  let newLine = 1;
  let cursor = 0;
  let emitted = 0;
  for (const range of ranges) {
    while (cursor < range.start) {
      if (diff[cursor]!.kind !== '+') oldLine += 1;
      if (diff[cursor]!.kind !== '-') newLine += 1;
      cursor += 1;
    }
    const slice = diff.slice(range.start, range.end);
    const oldCount = slice.filter(({ kind }) => kind !== '+').length;
    const newCount = slice.filter(({ kind }) => kind !== '-').length;
    output.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`);
    for (const line of slice) {
      output.push(`${line.kind}${line.text}`);
      if (line.kind !== '+') oldLine += 1;
      if (line.kind !== '-') newLine += 1;
      emitted += 1;
      if (emitted >= 240) {
        output.push('… diff truncated; inspect the files before choosing to replace them.');
        return output.join('\n');
      }
    }
    cursor = range.end;
  }
  return output.join('\n');
}
