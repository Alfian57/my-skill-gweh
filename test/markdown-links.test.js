import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localMarkdownTargets, relocateMarkdownLinks } from '../dist/markdown-links.js';

test('Markdown reference scanning ignores fenced and inline code and reads reference links', () => {
  const markdown = [
    '[guide](<docs/guide with spaces.md> "Guide")',
    '[reference][api]',
    '',
    '[api]: ../api.md',
    '',
    '```md',
    '[example](missing-in-fence.md)',
    '```',
    '',
    '`[inline](missing-inline.md)`',
    '[external](https://example.com)',
    '[fragment](#section)',
  ].join('\n');
  assert.deepEqual(localMarkdownTargets(markdown), ['docs/guide%20with%20spaces.md', '../api.md']);
});

test('Markdown reference scanning supports shortcut and collapsed references without duplicates', () => {
  const markdown = '[API]\n[API][]\n\n[api]: /reference/';
  assert.deepEqual(localMarkdownTargets(markdown), ['/reference/']);
});

test('retained documents rebase inline and reference links but leave code and comments unchanged', () => {
  const markdown = [
    '[Context](../project/context.md)',
    '[Guide](<../assets/guide v1.md> "Guide")',
    '[API][api]',
    '',
    '[api]: ../project/api.md',
    '',
    '`[inline](../missing-inline.md)`',
    '',
    '```md',
    '[example](../missing-fence.md)',
    '```',
    '',
    '<!-- [comment](../missing-comment.md) -->',
  ].join('\n');
  const moved = relocateMarkdownLinks(
    markdown,
    '/project',
    'ai-agent-docs/engineering/custom.md',
    'ai-agent-docs/retained/engineering/custom.retained.md',
  );
  assert.match(moved, /\]\(\.\.\/\.\.\/project\/context\.md\)/u);
  assert.match(moved, /<\.\.\/\.\.\/assets\/guide%20v1\.md>/u);
  assert.match(moved, /^\[api\]: \.\.\/\.\.\/project\/api\.md$/mu);
  assert.match(moved, /`\[inline\]\(\.\.\/missing-inline\.md\)`/u);
  assert.match(moved, /\[example\]\(\.\.\/missing-fence\.md\)/u);
  assert.match(moved, /<!-- \[comment\]\(\.\.\/missing-comment\.md\) -->/u);
});

test('relocation ignores Markdown-looking text in raw HTML and matches duplicate destinations by source', () => {
  const markdown = [
    '<div>',
    '[example](assets/file.md)',
    '</div>',
    '',
    '[actual](assets/file.md)',
  ].join('\n');
  const moved = relocateMarkdownLinks(markdown, '/project', 'docs/old.md', 'docs/moved/new.md');
  assert.match(moved, /\[example\]\(assets\/file\.md\)/u);
  assert.match(moved, /\[actual\]\(\.\.\/assets\/file\.md\)/u);
});

test('relocation writes a dot destination when a directory link now targets the same folder', () => {
  const moved = relocateMarkdownLinks('[folder](moved)\n', '/project', 'old.md', 'moved/new.md');
  assert.equal(moved, '[folder](.)\n');
});
