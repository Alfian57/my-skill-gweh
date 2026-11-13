export type Write = (text: string) => void;

export function report(value: unknown, json: boolean, write: Write): void {
  if (json || typeof value !== 'object' || value === null) {
    write(typeof value === 'string' && !json ? value : JSON.stringify(value, null, 2));
    return;
  }
  for (const [label, items] of Object.entries(value)) {
    if (Array.isArray(items)) {
      write(`${label}: ${items.length}`);
      for (const item of items)
        write(`  - ${typeof item === 'string' ? item : JSON.stringify(item)}`);
    } else {
      write(`${label}: ${JSON.stringify(items)}`);
    }
  }
}
