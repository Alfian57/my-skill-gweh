import { createHash } from 'node:crypto';

/** Reruns may skip a published version only when its tarball is byte-for-byte identical. */
export function publicationNeeded(tarball, existing) {
  if (existing === undefined) return true;
  const integrity = createHash('sha512').update(tarball).digest('base64');
  if (existing?.dist?.integrity !== `sha512-${integrity}`) {
    throw new Error(
      'This npm version already exists with a different tarball. Prepare a new version instead of overwriting it.',
    );
  }
  return false;
}
