export const agents = [
  'codex',
  'claude',
  'gemini',
  'cursor',
  'opencode',
  'copilot',
  'windsurf',
  'antigravity',
] as const;

export type Agent = (typeof agents)[number];
export type Language = 'id' | 'en';
type Translation = Readonly<Record<Language, string>>;

export const rules = {
  quality: {
    en: 'Keep modules focused; separate complex UI logic, colocate feature code, and reuse existing abstractions.',
    id: 'Jaga modul tetap terfokus; pisahkan logika UI kompleks, gunakan co-location, dan manfaatkan abstraksi yang ada.',
  },
  docs: {
    en: 'Update affected documentation with behavior changes. Describe implemented behavior, not assumptions.',
    id: 'Sinkronkan dokumentasi dengan perubahan perilaku. Jelaskan kondisi terimplementasi, bukan asumsi.',
  },
  contracts: {
    en: 'Preserve API contracts, authorization, ownership and privacy boundaries. Never expose credentials or sensitive payloads in logs.',
    id: 'Pertahankan kontrak API, otorisasi, ownership, dan privasi. Jangan mencatat kredensial atau payload sensitif.',
  },
  testing: {
    en: 'Maintain meaningful regression tests for changed behavior. Report actual results and commands not run.',
    id: 'Pelihara test regresi bermakna untuk perubahan perilaku. Laporkan hasil aktual dan perintah yang belum dijalankan.',
  },
  'ui-size': {
    en: 'Review UI components exceeding 250 lines for focused extraction; this is a soft limit.',
    id: 'Evaluasi komponen UI di atas 250 baris untuk ekstraksi terfokus; ini batas lunak.',
  },
  'zero-any': {
    en: 'Use unknown and narrowing instead of any or type suppression in TypeScript.',
    id: 'Gunakan unknown dan narrowing, bukan any atau penonaktifan pemeriksaan tipe TypeScript.',
  },
  routes: {
    en: 'Use the project’s established route helpers and keep URL behavior at its owning boundary.',
    id: 'Gunakan helper rute proyek dan jaga perilaku URL pada boundary pemiliknya.',
  },
  forms: {
    en: 'Provide clear field labels, server-backed validation, and visible submission and error states.',
    id: 'Sediakan label field yang jelas, validasi server, serta status submit dan error yang terlihat.',
  },
  'ui-tests': {
    en: 'Test changed UI behavior with the project’s existing runner and meaningful user-facing assertions.',
    id: 'Uji perilaku UI yang berubah dengan runner proyek dan assertion yang bermakna bagi pengguna.',
  },
  accessibility: {
    en: 'Verify keyboard navigation, visible focus and accessible control labels.',
    id: 'Periksa navigasi keyboard, focus terlihat, dan label kontrol aksesibel.',
  },
  mascot: {
    en: 'Design a project mascot and keep future mascot images consistent with its visual reference.',
    id: 'Rancang maskot proyek dan jaga konsistensi gambar maskot berikutnya dengan panduan visualnya.',
  },
  dependencies: {
    en: 'Explain why a new dependency is needed before adding it; prefer existing suitable utilities.',
    id: 'Jelaskan kebutuhan dependency baru sebelum menambahkannya; utamakan utilitas yang sudah sesuai.',
  },
} as const satisfies Record<string, Translation>;

export type Skill = keyof typeof rules;
export const skillIds = Object.keys(rules) as Skill[];

/** Increment when a new optional skill becomes available to existing projects. */
export const SKILL_CATALOG_REVISION = 1;

const skillIntroducedAt: Record<Skill, number> = {
  quality: 0,
  docs: 0,
  contracts: 0,
  testing: 0,
  'ui-size': 0,
  'zero-any': 0,
  routes: 0,
  forms: 0,
  'ui-tests': 0,
  accessibility: 0,
  mascot: 1,
  dependencies: 0,
};

export function skillsIntroducedAfter(revision: number): Skill[] {
  return skillIds.filter((skill) => skillIntroducedAt[skill] > revision);
}

// Preserve the original core API while consumers move to named language keys.
export const catalog = Object.fromEntries(
  skillIds.map((id) => [id, [rules[id].en, rules[id].id] as const]),
);
