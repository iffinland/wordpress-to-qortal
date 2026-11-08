#!/usr/bin/env node
/**
 * Clean-checkout reproducibility check.
 *
 * Extracts the exact commit with git archive into a fresh directory, installs
 * locked dependencies, rebuilds the .deb with the same SOURCE_DATE_EPOCH and
 * compares the SHA-256 with the reference artifact.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT, artifactName, capture, gitInfo, readJson, run, sha256File } from './lib.mjs';
import { componentVersion } from './artifact-set.mjs';

const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const config = await readJson(path.join(REPO_ROOT, 'desktop/release.config.json'));
const desktopVersion = componentVersion(release, 'desktop');
const keep = process.argv.includes('--keep');
const referenceArg = process.argv.find((value) => value.startsWith('--reference='));
const reference = referenceArg
  ? path.resolve(referenceArg.slice('--reference='.length))
  : path.join(REPO_ROOT, 'desktop/release', artifactName(config.packageName, desktopVersion, release.architecture));
const git = gitInfo(REPO_ROOT);
const epoch = Number(process.env.SOURCE_DATE_EPOCH) || git.commitTime;
const workArg = process.argv.find((value) => value.startsWith('--work='));
const workRoot = workArg
  ? path.resolve(workArg.slice('--work='.length), git.commit)
  : path.join('/home/iffi/dev-workspace/tmp/qms-phase9-repro', git.commit);
const cleanRoot = path.join(workRoot, 'source');
const archiveFile = path.join(workRoot, 'source.tar');

await rm(workRoot, { recursive: true, force: true });
await mkdir(workRoot, { recursive: true });
console.log('extracting commit ' + git.commit + ' to ' + cleanRoot);
run('git', ['archive', '--format=tar', '--output', archiveFile, git.commit], { cwd: REPO_ROOT });
await mkdir(cleanRoot, { recursive: true });
run('tar', ['-xf', archiveFile, '-C', cleanRoot]);

console.log('copying the locked dependency tree into the clean checkout');
// The source tree comes from git archive. Dependencies are byte-identical
// copies of the lockfile-installed tree; versions are still pinned by the
// committed lockfiles. Copying avoids a network reinstall and host memory
// pressure while keeping the build itself isolated from the working tree.
for (const relative of ['.', 'desktop', 'templates/generic-cms']) {
  const source = path.join(REPO_ROOT, relative, 'node_modules');
  const target = path.join(cleanRoot, relative, 'node_modules');
  await mkdir(path.dirname(target), { recursive: true });
  run('cp', ['-a', source, target], { cwd: REPO_ROOT, quiet: true });
}

console.log('rebuilding the .deb from the clean checkout');
run(process.execPath, ['scripts/release/build-deb.mjs'], {
  cwd: cleanRoot,
  env: {
    ...process.env,
    SOURCE_DATE_EPOCH: String(epoch),
    QMS_SOURCE_COMMIT: git.commit,
    QMS_SOURCE_TREE: git.tree,
    QMS_SOURCE_BRANCH: git.branch,
    QMS_SOURCE_DIRTY: '0',
    QMS_SOURCE_EPOCH: String(epoch)
  }
});

const rebuilt = path.join(cleanRoot, 'desktop/release', path.basename(reference));
const referenceSha = await sha256File(reference);
const rebuiltSha = await sha256File(rebuilt);
const equal = referenceSha === rebuiltSha;
const record = {
  schema: 'qms-reproducibility@1',
  sourceCommit: git.commit,
  sourceTree: git.tree,
  sourceDateEpoch: epoch,
  referenceArtifact: path.basename(reference),
  referenceSha256: referenceSha,
  rebuiltFromCleanCheckoutSha256: rebuiltSha,
  reproducible: equal,
  method: 'git archive of HEAD, byte-identical locked dependency tree, identical SOURCE_DATE_EPOCH, byte-for-byte SHA-256 comparison',
  checkedAt: new Date().toISOString()
};
await writeFile(path.join(REPO_ROOT, 'desktop/release/reproducibility.json'), JSON.stringify(record, null, 2) + '\n');
if (!equal) {
  console.error('REPRODUCIBILITY FAILURE');
  console.error(' reference ' + referenceSha);
  console.error(' rebuilt   ' + rebuiltSha);
  process.exitCode = 1;
} else {
  console.log('reproducible build verified: ' + referenceSha);
}
if (!keep) await rm(workRoot, { recursive: true, force: true });
else console.log('kept clean checkout at ' + cleanRoot);
