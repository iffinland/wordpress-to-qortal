import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this module location (no cwd assumptions). */
export function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}
