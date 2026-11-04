// Compatibility wrapper: package verification moved to the release pipeline.
// The authoritative validator checks metadata, layout, permissions, engine and
// template hashes, and forbidden development material.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [path.resolve(here, '../../scripts/release/validate-artifact.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit'
});
process.exit(result.status ?? 1);
