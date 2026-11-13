import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, parseConfig } from '../dist/config.js';

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['unsupported version', { ...defaults(), version: 2 }],
  ['unknown field', { ...defaults(), docLanguage: 'id' }],
  ['prototype skill', { ...defaults(), skills: ['constructor'] }],
  ['unknown agent', { ...defaults(), agents: ['gpt'] }],
  ['empty agents', { ...defaults(), agents: [] }],
  ['duplicate skills', { ...defaults(), skills: ['docs', 'docs'] }],
  ['non-string stack', { ...defaults(), stack: [{}] }],
  ['multiline stack', { ...defaults(), stack: ['go\nInjected text'] }],
  ['array workflow', { ...defaults(), git: ['existing'] }],
  ['unsupported custom skills', { ...defaults(), customSkills: ['./custom'] }],
  ['absolute output', { ...defaults(), output: '/outside' }],
  ['parent traversal', { ...defaults(), output: '../outside' }],
  ['metadata collision', { ...defaults(), output: '.my-skill-gweh/docs' }],
  ['git collision', { ...defaults(), output: '.git/docs' }],
  ['Windows device name', { ...defaults(), output: 'CON/rules' }],
  ['Windows device extension', { ...defaults(), output: 'aux.txt' }],
  ['trailing dot', { ...defaults(), output: 'docs.' }],
  ['case-insensitive metadata folder', { ...defaults(), output: '.MY-SKILL-GWEH/docs' }],
  ['case-insensitive Git folder', { ...defaults(), output: '.Git/docs' }],
  ['lock collision', { ...defaults(), output: '.my-skill-gweh.lock/docs' }],
  ['unsupported filename character', { ...defaults(), output: 'docs|rules' }],
  ['ambiguous separator', { ...defaults(), output: 'docs\\rules' }],
]) {
  test(`configuration rejects ${label}`, () => {
    assert.throws(() => parseConfig(value));
  });
}

test('configuration snapshots arrays and accepts portable custom folders', () => {
  const input = { ...defaults(), output: 'team docs/engineering (#1)', customSkills: [] };
  const parsed = parseConfig(input);
  parsed.skills.push('routes');
  assert.ok(!input.skills.includes('routes'));
  assert.equal(parsed.output, input.output);
  assert.equal('customSkills' in parsed, false);
});
