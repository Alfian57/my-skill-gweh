import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStack, resolveStack } from '../dist/stack.js';

test('framework and adapter choices include their required technologies', () => {
  const resolved = resolveStack(['laravel', 'gin', 'nextjs', 'inertia', 'custom-stack']);

  assert.deepEqual(resolved.values, [
    'php',
    'go',
    'laravel',
    'nextjs',
    'gin',
    'react',
    'inertia',
    'custom-stack',
  ]);
  assert.deepEqual(resolved.requiredBy, {
    php: ['laravel'],
    go: ['gin'],
    react: ['nextjs', 'inertia'],
  });
});

test('stack descriptions distinguish languages from frameworks and integrations', () => {
  assert.equal(
    formatStack(['laravel', 'inertia'], 'id'),
    'Bahasa: PHP (diperlukan oleh Laravel)\n' +
      'Framework: Laravel\n' +
      'Library dan integrasi: React (diperlukan oleh Inertia.js (adapter React)), Inertia.js (adapter React)',
  );
});

test('custom stack names that collide with object properties are safe', () => {
  assert.deepEqual(resolveStack(['constructor', '__proto__']).values, ['constructor', '__proto__']);
});
