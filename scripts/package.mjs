import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root, runNpm, packageMetadata } from './lib.mjs';

const metadata = await packageMetadata();
const filename = `${metadata.name}-${metadata.version}.tgz`;
const directory = path.join(root, 'artifacts');
await mkdir(directory, { recursive: true });
runNpm(['pack', '--pack-destination', directory]);
const tarball = path.join(directory, filename);
const digest = createHash('sha256')
  .update(await readFile(tarball))
  .digest('hex');
await writeFile(`${tarball}.sha256`, `${digest}  ${filename}\n`);
console.log(`Package: ${tarball}\nSHA-256: ${digest}`);

if (process.env.GITHUB_OUTPUT) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `tarball=artifacts/${filename}\nchecksum=artifacts/${filename}.sha256\n`,
  );
}
