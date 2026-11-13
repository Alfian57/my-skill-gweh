import { rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { root, runNode } from './lib.mjs';

const require = createRequire(import.meta.url);
await rm(path.join(root, 'dist'), { recursive: true, force: true });
runNode([require.resolve('typescript/bin/tsc'), '--project', path.join(root, 'tsconfig.json')]);
