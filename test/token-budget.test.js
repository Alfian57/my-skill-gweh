import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../dist/config.js';
import { skillIds } from '../dist/catalog.js';
import { replaceManagedContent } from '../dist/managed-content.js';
import { renderDocuments, skillGuidePath } from '../dist/render.js';

const context = {
  name: 'example-app',
  stack: ['php', 'laravel', 'typescript', 'react', 'inertia', 'nextjs'],
  detectedStack: ['php', 'laravel', 'typescript', 'react', 'inertia', 'nextjs'],
  packageManager: 'npm',
  packageManagerEvidence: ['package-lock.json'],
  packageManagerAmbiguous: false,
  ecosystems: ['composer', 'javascript-packages'],
  sourceEvidence: ['.php', '.tsx'],
  facts: [],
  commands: [],
  areas: [
    {
      label: { id: 'Source', en: 'Source' },
      paths: ['app/Http/Kernel.php', 'src/routes/index.ts', 'tests/Feature/UserTest.php'],
    },
    {
      label: { id: 'Database', en: 'Database' },
      paths: ['database/migrations/2024_01_01_create_users.php'],
    },
  ],
  instructions: [],
  existingSkills: [],
  diagnostics: [],
  uiEvidence: true,
  nextRouter: 'app',
};

function managedLength(document) {
  return replaceManagedContent(undefined, document, undefined).content.length;
}

test('startup plus one relevant guide stays at least 25 percent smaller across stacks and agents', () => {
  const scenarios = [
    { language: 'en', stack: ['php', 'laravel'], agent: 'codex' },
    { language: 'id', stack: ['php', 'laravel'], agent: 'claude' },
    { language: 'en', stack: ['typescript', 'react'], agent: 'claude' },
    { language: 'id', stack: ['go', 'gin'], agent: 'codex' },
  ];
  const v013RepresentativeFlowCharacters = 8_495;
  const allowedCharacters = Math.floor(v013RepresentativeFlowCharacters * 0.75);

  for (const scenario of scenarios) {
    const ui = scenario.stack.some((technology) =>
      ['react', 'nextjs', 'inertia'].includes(technology),
    );
    const scenarioContext = {
      ...context,
      stack: scenario.stack,
      detectedStack: scenario.stack,
      ecosystems: scenario.stack.includes('go')
        ? ['go-modules']
        : ['composer', 'javascript-packages'],
      sourceEvidence: scenario.stack.includes('go') ? ['.go'] : ['.php', '.tsx'],
      uiEvidence: ui,
    };
    const config = {
      ...defaults(),
      docsLanguage: scenario.language,
      agents: [scenario.agent],
      skills: [...skillIds],
      stack: scenario.stack,
    };
    const documents = renderDocuments(
      '/virtual/project',
      config,
      {
        stack: scenario.stack,
        evidence: scenario.stack.includes('go') ? ['go.mod'] : ['package.json', 'composer.json'],
        commands: {},
        ecosystems: scenarioContext.ecosystems,
        sourceEvidence: scenarioContext.sourceEvidence,
      },
      scenarioContext,
    );
    const nativeDirectory = scenario.agent === 'claude' ? '.claude/skills' : '.agents/skills';
    const entrypoint = scenario.agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
    const relevant = [
      entrypoint,
      `${config.output}/README.md`,
      `${nativeDirectory}/my-skill-gweh/SKILL.md`,
      skillGuidePath(config.output, 'quality'),
    ];
    const currentCharacters = relevant.reduce(
      (sum, file) => sum + managedLength(documents[file]),
      0,
    );
    assert.ok(
      currentCharacters <= allowedCharacters,
      `${scenario.language}/${scenario.agent}/${scenario.stack.join('+')}: expected <= ${allowedCharacters} characters (proxy), got ${currentCharacters}`,
    );
  }
});

test('one native skill summarizes all selected topics within the Skills spec limit', () => {
  const config = { ...defaults(), agents: ['codex'], skills: [...skillIds] };
  const documents = renderDocuments(
    '/virtual/project',
    config,
    {
      stack: [],
      evidence: [],
      commands: {},
      ecosystems: [],
      sourceEvidence: [],
    },
    context,
  );
  const nativeFiles = Object.keys(documents).filter((file) =>
    /\/my-skill-gweh\/SKILL\.md$/u.test(file),
  );
  assert.deepEqual(nativeFiles, ['.agents/skills/my-skill-gweh/SKILL.md']);
  const native = documents[nativeFiles[0]];
  const description = /^description: (.+)$/mu.exec(native.frontmatter ?? '')?.[1] ?? '';
  assert.ok(description.length > 0 && description.length <= 1024);
  for (const skill of skillIds) {
    assert.match(native.body, new RegExp(`^## ${skill}$`, 'mu'));
    assert.match(native.body, new RegExp(`${skill}(?:\.md| project guide)`, 'u'));
  }
  assert.match(documents['AGENTS.md'].body, /read only the relevant skill guide/u);
  assert.doesNotMatch(documents['AGENTS.md'].body, /read all|complete guide for each/u);
});

test('quality plus project workflow remains within the startup guidance character budget', () => {
  for (const scenario of [
    { language: 'en', agent: 'codex' },
    { language: 'id', agent: 'claude' },
  ]) {
    const config = {
      ...defaults(),
      docsLanguage: scenario.language,
      agents: [scenario.agent],
      skills: ['quality'],
    };
    const documents = renderDocuments(
      '/virtual/project',
      config,
      { stack: [], evidence: [], commands: {}, ecosystems: [], sourceEvidence: [] },
      { ...context, stack: [], detectedStack: [], uiEvidence: false },
    );
    const nativeDirectory = scenario.agent === 'claude' ? '.claude/skills' : '.agents/skills';
    const entrypoint = scenario.agent === 'claude' ? 'CLAUDE.md' : 'AGENTS.md';
    const relevant = [
      entrypoint,
      `${config.output}/README.md`,
      `${config.output}/project/workflow.md`,
      `${nativeDirectory}/my-skill-gweh/SKILL.md`,
      skillGuidePath(config.output, 'quality'),
    ];
    const characters = relevant.reduce((sum, file) => sum + managedLength(documents[file]), 0);
    assert.ok(
      characters < 8_000,
      `${scenario.language}/${scenario.agent} used ${characters} chars`,
    );
  }
});

test('mascot pose guidance stays short and concept detail is loaded only for a new identity', () => {
  for (const language of ['en', 'id']) {
    const config = { ...defaults(), docsLanguage: language, agents: ['codex'], skills: ['mascot'] };
    const documents = renderDocuments(
      '/virtual/project',
      config,
      { stack: [], evidence: [], commands: {}, ecosystems: [], sourceEvidence: [] },
      { ...context, stack: [], detectedStack: [], uiEvidence: false },
    );
    const guide = documents[skillGuidePath(config.output, 'mascot')].body;
    const concepts = documents[`${config.output}/application/mascot-concepts.md`].body;
    assert.ok(
      guide.length < 1_500,
      `${language} mascot pose instructions used ${guide.length} chars`,
    );
    assert.ok(
      concepts.length < 5_000,
      `${language} concept workflow used ${concepts.length} chars`,
    );
    assert.doesNotMatch(guide, /four separate PNGs|empat file PNG terpisah/u);
    assert.match(concepts, /four separate PNGs|empat file PNG terpisah/u);
  }
});
