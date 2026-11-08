#!/usr/bin/env node
/**
 * Builds and validates the complete QMS release artifact set.
 *
 * Every alpha/stable release must pass this command. It refuses to continue
 * when an artifact is missing, a Q-App ZIP is invalid, versions disagree, the
 * release manifest is incomplete, or SHA256SUMS omits a required artifact.
 */
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT, readJson } from './lib.mjs';
import { releaseArtifactPaths } from './artifact-set.mjs';
import { releaseTag } from './three-artifact-gate.mjs';

const args = new Set(process.argv.slice(2));
const tagArg = process.argv.find((value) => value.startsWith('--tag='))?.slice('--tag='.length) ?? null;
const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const tag = tagArg ?? releaseTag(release);

function run(label, command, commandArgs, options = {}) {
  console.log('\n=== ' + label + ' ===');
  const result = spawnSync(command, commandArgs, { cwd: REPO_ROOT, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error('release preparation failed at: ' + label);
    process.exit(result.status ?? 1);
  }
}

run('verify release version markers', process.execPath, ['scripts/qms-release.mjs', 'check']);
run('build Generic CMS root-layout Q-App', 'npm', ['run', 'cms-template:package']);
run('build Migration Publisher Q-App', 'npm', ['run', 'publisher:build']);
run('validate Migration Publisher bundle', 'npm', ['run', 'publisher:validate']);
run('package Migration Publisher Q-App', 'npm', ['run', 'publisher:package']);
run('build Debian package', 'npm', ['run', 'release:deb']);
run('validate Debian package', 'npm', ['run', 'release:validate']);
run('verify packaged engine JSON-RPC handshake from the extracted .deb', process.execPath, ['scripts/release/engine-clean-install-test.mjs']);
run('prove the gate detects a missing engine runtime dependency', process.execPath, ['scripts/release/engine-clean-install-test.mjs', '--hide-node-module=fflate', '--expect-failure']);
run('run release security gate', 'npm', ['run', 'release:security']);

if (!args.has('--skip-repro')) {
  const paths = releaseArtifactPaths(REPO_ROOT, release);
  const before = {};
  for (const kind of ['publisher', 'cms']) {
    before[kind] = await readFile(paths[kind]);
  }
  run('rebuild Generic CMS Q-App for reproducibility', 'npm', ['run', 'cms-template:package']);
  run('rebuild Migration Publisher Q-App for reproducibility', 'npm', ['run', 'publisher:package']);
  for (const kind of ['publisher', 'cms']) {
    const after = await readFile(paths[kind]);
    if (!before[kind].equals(after)) {
      console.error('reproducibility failure: ' + path.basename(paths[kind]) + ' changed between identical builds.');
      process.exit(1);
    }
  }
  console.log('Q-App ZIP reproducibility verified for both ZIPs.');
  run('verify .deb reproducibility from a clean checkout', process.execPath, ['scripts/release/repro-check.mjs']);
} else {
  console.log('WARNING: --skip-repro was used; reproducibility evidence is missing.');
}

run('enforce three-artifact release gate', process.execPath, ['scripts/release/three-artifact-gate.mjs', '--tag=' + tag]);
// BUG-003: a release must not ship while a three-post Quick scan can silently
// become a full inventory. The packaged acceptance run is a blocking gate.
run('enforce packaged bounded-scan acceptance evidence', 'npm', ['run', 'release:verify-packaged-scan']);
// BUG-004: the scan mode and bounded selection were dropped by the IPC
// allowlist. A release must also prove the whole essential workflow through the
// packaged app, including receipt import and exact read-back (H).
run('enforce packaged functional acceptance evidence', 'npm', ['run', 'release:verify-functional']);
run('generate CycloneDX SBOM', 'npm', ['run', 'release:sbom']);
run('generate build provenance', 'npm', ['run', 'release:provenance']);
run('verify release state and checksums', 'npm', ['run', 'release:verify']);

console.log('\nRelease preparation complete for ' + release.product + ' ' + release.version + ' (' + tag + ').');
console.log('Artifacts are described by release/release-manifest.json and release/SHA256SUMS.');
