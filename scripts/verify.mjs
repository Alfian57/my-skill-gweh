import path from 'node:path';
import { packageMetadata, root, runNpm } from './lib.mjs';

runNpm(['run', 'check']);
runNpm(['test']);
runNpm(['run', 'package']);

const metadata = await packageMetadata();
const tarball = path.join(root, 'artifacts', `${metadata.name}-${metadata.version}.tgz`);
runNpm(['run', 'test:package', '--', tarball]);
