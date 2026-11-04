#!/usr/bin/env node
/**
 * Final release consistency gate and release-state separator.
 *
 * Release state (version, channel, signing, blockers, artifact identity) is
 * written to RELEASE-STATE.json. Installation and runtime evidence is written
 * separately to INSTALL-VERIFICATION.json and is never merged into release
 * state.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT, artifactName, gitInfo, readJson, sha256File, writeJson } from './lib.mjs';
import { runThreeArtifactGate } from './three-artifact-gate.mjs';

const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const config = await readJson(path.join(REPO_ROOT, 'desktop/release.config.json'));
const releaseDir = path.join(REPO_ROOT, 'desktop/release');
const artifact = path.join(releaseDir, artifactName(config.packageName, release.version, release.architecture));
const artifactInfo = await readJson(path.join(releaseDir, 'artifact.json'));
const validation = await readJson(path.join(releaseDir, 'validation.json'));
const security = await readJson(path.join(releaseDir, 'security-report.json'));
const sbom = await readJson(path.join(releaseDir, 'sbom.cdx.json'));
const provenance = await readJson(path.join(releaseDir, 'provenance.intoto.json'));
const buildInfo = await readJson(path.join(releaseDir, 'build-info.json'));
let reproducibility = null;
try {
  reproducibility = await readJson(path.join(releaseDir, 'reproducibility.json'));
} catch {
  reproducibility = null;
}
const installArg = process.argv.find((value) => value.startsWith('--install-evidence='));
const installEvidencePath = installArg ? path.resolve(installArg.slice('--install-evidence='.length)) : null;
const installEvidence = installEvidencePath ? await readJson(installEvidencePath) : null;

const sha256 = await sha256File(artifact);
const git = gitInfo(REPO_ROOT);
const failures = [];
function expect(name, condition) {
  if (!condition) failures.push(name);
}

const threeArtifactGate = await runThreeArtifactGate({ write: false });
expect('three-artifact release gate passes', threeArtifactGate.ok);
for (const failure of threeArtifactGate.failures) failures.push('three-artifact gate: ' + failure);
const requiredArtifacts = threeArtifactGate.manifest.artifacts;
for (const required of requiredArtifacts) {
  expect('required artifact recorded: ' + required.kind, Boolean(required.name && required.sha256));
}

expect('artifact sha matches artifact.json', artifactInfo.sha256 === sha256);
expect('artifact bytes match artifact.json', artifactInfo.bytes === (await readJson(path.join(releaseDir, 'artifact.json'))).bytes);
expect('build-info sha matches artifact', buildInfo.sha256 === sha256);
expect('provenance subject sha matches artifact', provenance.subject?.[0]?.digest?.sha256 === sha256);
expect('provenance records all three artifact subjects', requiredArtifacts.every((entry) => (provenance.subject ?? []).some((subject) => subject.name === entry.name && subject.digest?.sha256 === entry.sha256)));
expect('provenance commit matches artifact metadata', provenance.predicate?.buildDefinition?.resolvedDependencies?.some((entry) => entry.uri?.endsWith('@' + artifactInfo.sourceCommit)));
expect('SBOM component sha matches artifact', sbom.metadata?.component?.hashes?.some((entry) => entry.alg === 'SHA-256' && entry.content === sha256));
expect('SBOM commit matches artifact metadata', sbom.metadata?.component?.properties?.some((entry) => entry.name === 'qms:sourceCommit' && entry.value === artifactInfo.sourceCommit));
expect('validation passed', validation.failed === 0 && validation.checks > 0);
expect('security gate passed', security.verdict === 'pass');
expect('reproducible clean build', reproducibility.reproducible === true);
expect('release version matches artifact', artifactInfo.version === release.version);
expect('release commit matches current HEAD', artifactInfo.sourceCommit === git.commit);
expect('source tree clean at release', artifactInfo.dirty === false);

const blockers = [];
if (artifactInfo.signing !== 'signed') blockers.push('Artifact is unsigned: no owner-approved Debian signing key/mechanism is configured.');
blockers.push('AC9.7 live Qortal-network validation is not performed by this build; it requires explicit owner authorization for a read-only network check.');
if (!installEvidence) blockers.push('Install verification evidence has not been attached.');

const releaseState = {
  schema: 'qms-release-state@1',
  product: release.product,
  version: release.version,
  debianVersion: artifactInfo.debianVersion,
  channel: release.channel,
  architecture: release.architecture,
  status: failures.length === 0 ? 'release-candidate' : 'blocked',
  signing: {
    status: release.signing,
    mechanism: 'none',
    detail: release.signing === 'signed'
      ? 'Owner-approved signing mechanism recorded in qms-release.json.'
      : 'No owner-approved Debian signing mechanism was available. The artifact is an unsigned alpha release; verify SHA-256 and provenance before installation.'
  },
  artifact: {
    name: path.basename(artifact),
    bytes: artifactInfo.bytes,
    sha256
  },
  source: {
    commit: artifactInfo.sourceCommit,
    tree: artifactInfo.sourceTree,
    branch: artifactInfo.branch
  },
  checks: {
    artifactValidation: validation.checks,
    securityVerdict: security.verdict,
    reproducible: reproducibility.reproducible
  },
  blockers,
  releaseDecision: {
    approvedBy: null,
    approvedAt: null,
    note: 'Release state is recorded separately from install verification. Owner approval is required before treating this artifact as a public production release.'
  },
  consistencyFailures: failures,
  recordedAt: new Date().toISOString()
};

const installVerification = installEvidence ?? {
  schema: 'qms-install-verification@1',
  artifact: path.basename(artifact),
  sha256,
  status: 'pending',
  environments: [],
  notes: ['No install evidence was attached at release-state generation time.']
};

await writeJson(path.join(releaseDir, 'RELEASE-STATE.json'), releaseState);
await writeJson(path.join(releaseDir, 'INSTALL-VERIFICATION.json'), installVerification);

const sums = [];
const sumFiles = [
  ...requiredArtifacts.map((entry) => ({
    name: entry.name,
    absolute: entry.kind === 'deb' ? artifact : path.join(REPO_ROOT, 'release', entry.name)
  })),
  ...['sbom.cdx.json', 'provenance.intoto.json', 'build-info.json', 'artifact.json', 'validation.json', 'security-report.json', 'reproducibility.json', 'RELEASE-STATE.json', 'INSTALL-VERIFICATION.json']
    .map((file) => ({ name: file, absolute: path.join(releaseDir, file) }))
];
for (const file of sumFiles) {
  try {
    sums.push((await sha256File(file.absolute)) + '  ' + file.name);
  } catch {
    // Optional evidence file.
  }
}
sums.sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
for (const required of requiredArtifacts) {
  expect('SHA256SUMS includes ' + required.name, sums.some((line) => line.endsWith('  ' + required.name)));
}
await writeFile(path.join(releaseDir, 'SHA256SUMS'), sums.join('\n') + '\n');
await writeFile(path.join(REPO_ROOT, 'release', 'SHA256SUMS'), sums.join('\n') + '\n');

if (failures.length > 0) {
  console.error('release consistency check failed:');
  for (const failure of failures) console.error(' - ' + failure);
  process.exitCode = 1;
} else {
  console.log('release consistency verified');
  console.log(JSON.stringify({ version: release.version, artifact: path.basename(artifact), sha256, signing: release.signing, blockers: blockers.length }, null, 2));
}
