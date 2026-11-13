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
    en: 'Reuse centralized route definitions for navigation and API calls.',
    id: 'Gunakan definisi rute terpusat untuk navigasi dan panggilan API.',
  },
  forms: {
    en: 'Provide clear required/optional labels and loading, empty, error and large-data states.',
    id: 'Sediakan label wajib/opsional serta kondisi loading, kosong, error, dan data besar.',
  },
  'ui-tests': {
    en: 'Maintain a colocated behavior test for each changed UI component.',
    id: 'Pelihara test perilaku yang terlokasi bersama setiap komponen UI yang diubah.',
  },
  accessibility: {
    en: 'Verify keyboard navigation, visible focus and accessible control labels.',
    id: 'Periksa navigasi keyboard, focus terlihat, dan label kontrol aksesibel.',
  },
  dependencies: {
    en: 'Explain why a new dependency is needed before adding it; prefer existing suitable utilities.',
    id: 'Jelaskan kebutuhan dependency baru sebelum menambahkannya; utamakan utilitas yang sudah sesuai.',
  },
} as const satisfies Record<string, Translation>;

export type Skill = keyof typeof rules;
export const skillIds = Object.keys(rules) as Skill[];

// Preserve the original core API while consumers move to named language keys.
export const catalog = Object.fromEntries(
  skillIds.map((id) => [id, [rules[id].en, rules[id].id] as const]),
);
