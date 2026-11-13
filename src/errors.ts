export function isFileError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CancelledError extends Error {
  constructor() {
    super('Dibatalkan / Cancelled');
    this.name = 'CancelledError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
