import type { Language } from '../catalog.js';

export type Write = (text: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function paths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function localized(language: Language, en: string, id: string): string {
  return language === 'en' ? en : id;
}

function conflictMessage(detail: Record<string, unknown>, language: Language): string {
  const code = String(detail.reasonCode ?? '');
  const messages: Record<string, [string, string]> = {
    overlap: [
      'Developer edits overlap generated changes; resolve the sections individually.',
      'Edit developer bertumpuk dengan perubahan generator; selesaikan tiap bagian.',
    ],
    'work-limit': [
      'The file is too large for a safe automatic comparison.',
      'File terlalu besar untuk dibandingkan secara otomatis dengan aman.',
    ],
    'modified-removal': [
      'This customized output is no longer selected; choose retain or delete after backup.',
      'Output yang diedit tidak lagi dipilih; pilih simpan atau hapus setelah backup.',
    ],
    'nested-project': [
      'Run the CLI from the nested child project root.',
      'Jalankan CLI dari root child project tersebut.',
    ],
    ownership: [
      'Managed ownership could not be verified; inspect the existing content.',
      'Kepemilikan file terkelola tidak dapat diverifikasi; periksa konten yang ada.',
    ],
    unowned: [
      'The destination already contains content not managed by the generator.',
      'Tujuan sudah berisi konten yang tidak dikelola generator.',
    ],
  };
  return messages[code]?.[language === 'en' ? 0 : 1] ?? String(detail.reason ?? '');
}

function generationReport(value: Record<string, unknown>, write: Write, language: Language): void {
  const status = String(value.status ?? 'unknown');
  const planned = isRecord(value.planned) ? value.planned : {};
  const writes = paths(planned.writes);
  const removals = paths(planned.removals);
  const backups = paths(planned.backups);
  const metadata = paths(planned.metadata);
  const written = paths(value.written);
  const removed = paths(value.removed);
  const completedBackups = paths(value.backups);
  const skipped = paths(value.skipped);
  const conflicts = paths(value.conflicts);
  const listedWrites = written.filter((file) => !completedBackups.includes(file));

  const statusText: Record<string, [string, string]> = {
    applied: ['Applied', 'Diterapkan'],
    partial: ['Partially applied', 'Diterapkan sebagian'],
    preview: ['Preview only; no files were written', 'Pratinjau saja; belum ada file yang ditulis'],
    blocked: ['Blocked; no files were written', 'Terhenti; belum ada file yang ditulis'],
    cancelled: ['Cancelled; no files were changed', 'Dibatalkan; tidak ada file yang diubah'],
  };
  const empty = writes.length + removals.length + backups.length + metadata.length === 0;
  write(
    empty && status === 'applied'
      ? localized(
          language,
          'Up to date; no files changed.',
          'Sudah terbaru; tidak ada file yang berubah.',
        )
      : localized(language, statusText[status]?.[0] ?? status, statusText[status]?.[1] ?? status),
  );

  if (status === 'preview' || status === 'blocked') {
    write(
      localized(
        language,
        `Planned: ${writes.length} writes, ${removals.length} removals, ${backups.length} backups, ${metadata.length} metadata files.`,
        `Rencana: ${writes.length} penulisan, ${removals.length} penghapusan, ${backups.length} backup, ${metadata.length} file metadata.`,
      ),
    );
    for (const [label, items] of [
      ['write', writes],
      ['remove', removals],
      ['backup', backups],
      ['metadata', metadata],
    ] as const) {
      for (const file of items) write(`  ${label}: ${file}`);
    }
  } else {
    write(
      localized(
        language,
        `Completed: ${listedWrites.length} writes, ${removed.length} removals, ${completedBackups.length} backups.`,
        `Selesai: ${listedWrites.length} penulisan, ${removed.length} penghapusan, ${completedBackups.length} backup.`,
      ),
    );
    for (const file of listedWrites) write(`  write: ${file}`);
    for (const file of removed) write(`  remove: ${file}`);
    for (const file of completedBackups) write(`  backup: ${file}`);
  }

  const details = Array.isArray(value.conflictDetails) ? value.conflictDetails : [];
  for (const file of conflicts) {
    const detail = details.find((item) => isRecord(item) && item.file === file);
    write(
      `  ${localized(language, 'conflict', 'konflik')}: ${file}${isRecord(detail) && detail.reason ? ` — ${conflictMessage(detail, language)}` : ''}`,
    );
    if (isRecord(detail) && typeof detail.archivePath === 'string')
      write(
        `    ${localized(language, 'retained document', 'dokumen simpan')}: ${detail.archivePath}`,
      );
  }
  for (const file of skipped) write(`  ${localized(language, 'skipped', 'dilewati')}: ${file}`);
  for (const diagnostic of paths(value.diagnostics)) write(`  ! ${diagnostic}`);
  if (status === 'partial' || status === 'blocked') {
    write(
      localized(
        language,
        'Resolve the listed files, then run `my-skill-gweh update` again.',
        'Selesaikan file yang tercantum, lalu jalankan kembali `my-skill-gweh update`.',
      ),
    );
  }
}

function doctorReport(value: Record<string, unknown>, write: Write, language: Language): void {
  write(
    `${localized(language, 'Project state', 'Status project')}: ${String(value.state ?? 'unknown')}`,
  );
  const lock = isRecord(value.lock) ? value.lock : {};
  write(
    `${localized(language, 'Generation lock', 'Lock generator')}: ${String(lock.state ?? 'unknown')}`,
  );
  for (const key of [
    'missing',
    'conflicts',
    'drift',
    'orphaned',
    'diagnostics',
    'invalidReferences',
  ]) {
    const items = Array.isArray(value[key]) ? value[key] : [];
    if (!items.length) continue;
    write(`${key}: ${items.length}`);
    for (const item of items)
      write(`  - ${typeof item === 'string' ? item : JSON.stringify(item)}`);
  }
}

export function report(
  value: unknown,
  json: boolean,
  write: Write,
  language: Language = 'id',
): void {
  if (json || typeof value !== 'object' || value === null) {
    write(typeof value === 'string' && !json ? value : JSON.stringify(value, null, 2));
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.status === 'string' && isRecord(record.planned)) {
    generationReport(record, write, language);
    return;
  }
  if (typeof record.state === 'string' && Array.isArray(record.invalidReferences)) {
    doctorReport(record, write, language);
    return;
  }
  for (const [label, items] of Object.entries(record)) {
    if (Array.isArray(items)) {
      write(`${label}: ${items.length}`);
      for (const item of items)
        write(`  - ${typeof item === 'string' ? item : JSON.stringify(item)}`);
    } else {
      write(`${label}: ${JSON.stringify(items)}`);
    }
  }
}
