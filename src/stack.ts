import type { Language } from './catalog.js';

export type StackCategory = 'language' | 'framework' | 'library';

interface StackEntry {
  category: StackCategory;
  label: Record<Language, string>;
  description: Record<Language, string>;
}

export const stackCatalog = {
  javascript: {
    category: 'language',
    label: { id: 'JavaScript', en: 'JavaScript' },
    description: {
      id: 'Bahasa pemrograman untuk source .js, .jsx, .mjs, atau .cjs.',
      en: 'Programming language for .js, .jsx, .mjs, or .cjs source files.',
    },
  },
  typescript: {
    category: 'language',
    label: { id: 'TypeScript', en: 'TypeScript' },
    description: {
      id: 'Bahasa pemrograman untuk source .ts, .tsx, .mts, atau .cts.',
      en: 'Programming language for .ts, .tsx, .mts, or .cts source files.',
    },
  },
  php: {
    category: 'language',
    label: { id: 'PHP', en: 'PHP' },
    description: {
      id: 'Bahasa pemrograman server; diperlukan oleh Laravel.',
      en: 'Server-side programming language; required by Laravel.',
    },
  },
  go: {
    category: 'language',
    label: { id: 'Go', en: 'Go' },
    description: {
      id: 'Bahasa pemrograman; diperlukan oleh Gin.',
      en: 'Programming language; required by Gin.',
    },
  },
  laravel: {
    category: 'framework',
    label: { id: 'Laravel', en: 'Laravel' },
    description: {
      id: 'Framework aplikasi berbasis PHP.',
      en: 'Application framework built with PHP.',
    },
  },
  nextjs: {
    category: 'framework',
    label: { id: 'Next.js', en: 'Next.js' },
    description: {
      id: 'Framework web berbasis React; React otomatis disertakan.',
      en: 'Web framework built on React; React is included automatically.',
    },
  },
  gin: {
    category: 'framework',
    label: { id: 'Gin', en: 'Gin' },
    description: {
      id: 'Framework web untuk Go; Go otomatis disertakan.',
      en: 'Web framework for Go; Go is included automatically.',
    },
  },
  react: {
    category: 'library',
    label: { id: 'React', en: 'React' },
    description: {
      id: 'Library UI untuk JavaScript atau TypeScript.',
      en: 'UI library for JavaScript or TypeScript.',
    },
  },
  inertia: {
    category: 'library',
    label: { id: 'Inertia.js (adapter React)', en: 'Inertia.js (React adapter)' },
    description: {
      id: 'Adapter Inertia.js untuk React; React otomatis disertakan.',
      en: 'Inertia.js adapter for React; React is included automatically.',
    },
  },
} as const satisfies Record<string, StackEntry>;

export type StackTechnology = keyof typeof stackCatalog;
export const stackTechnologies = Object.keys(stackCatalog) as StackTechnology[];

const requirements: Partial<Record<StackTechnology, readonly StackTechnology[]>> = {
  laravel: ['php'],
  nextjs: ['react'],
  gin: ['go'],
  inertia: ['react'],
};

export interface ResolvedStack {
  values: string[];
  requiredBy: Record<string, string[]>;
}

export function resolveStack(values: readonly string[]): ResolvedStack {
  const selected = new Set<string>();
  const requiredBy = new Map<string, Set<string>>();

  function include(value: string, parent?: string): void {
    if (parent) {
      const parents = requiredBy.get(value) ?? new Set<string>();
      parents.add(parent);
      requiredBy.set(value, parents);
    }
    if (selected.has(value)) return;
    selected.add(value);
    const children = requirements[value as StackTechnology] ?? [];
    for (const child of children) include(child, value);
  }

  for (const value of values) include(value);

  const known = stackTechnologies.filter((value) => selected.has(value));
  const custom = [...selected].filter((value) => !Object.hasOwn(stackCatalog, value));
  return {
    values: [...known, ...custom],
    requiredBy: Object.fromEntries(
      [...requiredBy].map(([value, parents]) => [value, [...parents]]),
    ),
  };
}

const categoryNames: Record<Language, Record<StackCategory, string>> = {
  id: { language: 'Bahasa', framework: 'Framework', library: 'Library dan integrasi' },
  en: { language: 'Languages', framework: 'Frameworks', library: 'Libraries and integrations' },
};

export function formatStack(
  values: readonly string[],
  language: Language,
  options: { markdown?: boolean } = {},
): string {
  const resolved = resolveStack(values);
  const groups = (['language', 'framework', 'library'] as const).map((category) => {
    const entries = resolved.values
      .filter(
        (value): value is StackTechnology =>
          Object.hasOwn(stackCatalog, value) &&
          stackCatalog[value as StackTechnology].category === category,
      )
      .map((value) => {
        const label = stackCatalog[value].label[language];
        const parents = resolved.requiredBy[value] ?? [];
        if (!parents.length) return label;
        const reasons = parents.map((parent) =>
          Object.hasOwn(stackCatalog, parent)
            ? stackCatalog[parent as StackTechnology].label[language]
            : parent,
        );
        const suffix =
          language === 'id'
            ? ` (diperlukan oleh ${reasons.join(', ')})`
            : ` (required by ${reasons.join(', ')})`;
        return `${label}${suffix}`;
      });
    return entries.length
      ? `${categoryNames[language][category]}: ${entries.join(', ')}`
      : undefined;
  });
  const custom = resolved.values.filter((value) => !Object.hasOwn(stackCatalog, value));
  if (custom.length) {
    const labels = options.markdown
      ? custom.map((value) => `\`${value.replaceAll('`', '')}\``)
      : custom;
    groups.push(`${language === 'id' ? 'Lainnya' : 'Other'}: ${labels.join(', ')}`);
  }
  return groups.filter((line): line is string => line !== undefined).join('\n');
}
