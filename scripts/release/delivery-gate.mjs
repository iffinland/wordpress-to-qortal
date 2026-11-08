#!/usr/bin/env node
/**
 * Permanent release-delivery gates.
 *
 * Two owner rules are enforced here, not only documented:
 *  (a) every release-facing fix ships a uniquely versioned, tested,
 *      GitHub-downloadable installable package;
 *  (b) every code fix and package release ships its documentation updates.
 *
 * The gate is called by release-prepare.mjs before any build (uniqueness and
 * docs), again before publishing (artifacts + docs + unique tag), and
 * publish-release.mjs refuses to create a release unless the recorded gate
 * evidence matches the release version, tag and artifact hashes. Download
 * verification remains in publish-release.mjs, which fetches every public
 * asset over HTTPS and re-hashes it.
 */
import { spawnSync } from 'node:child_process';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT, readJson, sha256File } from './lib.mjs';
import { REQUIRED_ARTIFACT_KINDS, releaseArtifactPaths } from './artifact-set.mjs';
import { releaseTag } from './three-artifact-gate.mjs';
import { checkVersions } from '../qms-release.mjs';

const REPO = 'iffinland/wordpress-to-qortal';
const GH = process.env.GH_BIN || '/home/iffi/.local/bin/gh';
const REQUIRED_DOCS = [
  'README.md',
  'QUICKSTART.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'docs/migration-studio/RELEASE-WORKFLOW.md',
  'docs/migration-studio/RELEASE-DELIVERY-CHECKLIST.md',
  'docs/migration-studio/INSTALL-LINUX.md'
];

function capture(command, args, options = {}) {
  return spawnSync(command, args, { cwd: REPO_ROOT, encoding: 'utf8', ...options });
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export async function checkUniqueVersion({ repoRoot = REPO_ROOT, release, tag = releaseTag(release), stage = 'prebuild' }) {
  const errors = [];
  if (release.releaseTag && release.releaseTag !== tag) {
    errors.push('release descriptor tag ' + release.releaseTag + ' does not match requested tag ' + tag + '.');
  }
  const versions = await checkVersions(repoRoot);
  if (!versions.ok) errors.push(...versions.failures.map((failure) => 'version marker: ' + failure));

  const artifact = await readJson(path.join(repoRoot, 'desktop/release/artifact.json')).catch(() => null);
  const sourceCommit = artifact?.sourceCommit ?? null;

  // The exact release tag is allowed to exist only when it pins the artifact
  // commit. A reused version, a moved tag or a different target is a failure.
  const local = capture('git', ['tag', '--list', tag], { cwd: repoRoot });
  const localExists = local.status === 0 && local.stdout.trim() !== '';
  if (local.status !== 0) {
    errors.push('cannot inspect local tags: ' + (local.stderr || 'git tag failed'));
  } else if (localExists) {
    const target = capture('git', ['rev-parse', tag + '^{}'], { cwd: repoRoot });
    if (!sourceCommit || target.status !== 0 || target.stdout.trim() !== sourceCommit) {
      errors.push('tag ' + tag + ' exists locally but does not point at the artifact commit ' + (sourceCommit || '<missing>') + '.');
    }
  } else if (stage === 'prepublish') {
    errors.push('tag ' + tag + ' does not exist locally; create it at the artifact commit before publishing.');
  }

  const remote = capture('git', ['ls-remote', 'origin', 'refs/tags/' + tag + '^{}', 'refs/tags/' + tag], { cwd: repoRoot });
  if (remote.status !== 0) {
    errors.push('cannot verify remote tag uniqueness: ' + (remote.stderr || 'git ls-remote failed'));
  } else {
    const lines = remote.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    const exact = lines.find((line) => line.endsWith('refs/tags/' + tag + '^{}')) ?? lines.find((line) => line.endsWith('refs/tags/' + tag));
    if (exact) {
      const remoteTarget = exact.split(/\s+/)[0];
      if (!sourceCommit || remoteTarget !== sourceCommit) {
        errors.push('tag ' + tag + ' exists on origin but points at ' + remoteTarget + ', not the artifact commit ' + (sourceCommit || '<missing>') + '.');
      }
    } else if (stage === 'prepublish') {
      errors.push('tag ' + tag + ' does not exist on origin; create it at the artifact commit before publishing.');
    }
  }

  // Public REST lookup, so the same gate works on build hosts without gh.
  try {
    const response = await fetch('https://api.github.com/repos/' + REPO + '/releases/tags/' + encodeURIComponent(tag), {
      headers: { 'user-agent': 'qms-release-delivery-gate', accept: 'application/vnd.github+json' }
    });
    if (response.status === 200) {
      errors.push('GitHub release ' + tag + ' already exists; existing releases and assets are immutable.');
    } else if (response.status !== 404) {
      errors.push('cannot verify GitHub release uniqueness for ' + tag + ': HTTP ' + response.status + '.');
    }
  } catch (error) {
    errors.push('cannot verify GitHub release uniqueness for ' + tag + ': ' + String(error?.message ?? error));
  }

  for (const kind of REQUIRED_ARTIFACT_KINDS) {
    const name = path.basename(releaseArtifactPaths(repoRoot, release)[kind]);
    const expected = release.components?.[kind === 'deb' ? 'desktop' : kind]?.version ?? release.version;
    if (!name.includes(expected)) {
      errors.push('artifact name does not carry the unique component version ' + expected + ': ' + name);
    }
  }
  return { ok: errors.length === 0, errors, tag };
}

export async function checkReleaseDocs({ repoRoot = REPO_ROOT, release }) {
  const errors = [];
  const notesFile = path.join(repoRoot, release.releaseNotes);
  if (!(await exists(notesFile))) {
    errors.push('release notes file is missing: ' + release.releaseNotes);
  } else {
    const notes = await readFile(notesFile, 'utf8');
    if (!notes.includes('<!-- qms-release-version: ' + release.version + ' -->')) {
      errors.push('release notes do not carry the version marker for ' + release.version + '.');
    }
    if (!notes.includes(release.version)) {
      errors.push('release notes do not name version ' + release.version + '.');
    }
  }
  const changelog = await readFile(path.join(repoRoot, 'CHANGELOG.md'), 'utf8').catch(() => '');
  if (!changelog) {
    errors.push('CHANGELOG.md is missing.');
  } else if (!changelog.split('\n').some((line) => /^#{1,3}\s/.test(line) && line.includes(release.version))) {
    errors.push('CHANGELOG.md has no heading entry for ' + release.version + '.');
  }
  for (const relative of REQUIRED_DOCS) {
    const file = path.join(repoRoot, relative);
    if (!(await exists(file))) {
      errors.push('required release documentation is missing: ' + relative);
      continue;
    }
    const info = await stat(file);
    if (info.size < 200) errors.push('required release documentation is implausibly small: ' + relative);
  }
  const workflow = await readFile(path.join(repoRoot, 'docs/migration-studio/RELEASE-WORKFLOW.md'), 'utf8').catch(() => '');
  for (const phrase of [
    'unique',
    'GitHub-downloadable',
    'documentation updates',
    'RELEASE-DELIVERY-CHECKLIST.md'
  ]) {
    if (!workflow.toLowerCase().includes(phrase.toLowerCase())) {
      errors.push('RELEASE-WORKFLOW.md does not state the permanent rule containing "' + phrase + '".');
    }
  }
  return { ok: errors.length === 0, errors };
}

export async function checkInstallableArtifacts({ repoRoot = REPO_ROOT, release, tag = releaseTag(release) }) {
  const errors = [];
  const releaseDir = path.join(repoRoot, 'release');
  let manifest = null;
  try {
    manifest = await readJson(path.join(releaseDir, 'release-manifest.json'));
  } catch {
    return { ok: false, errors: ['release manifest is missing; run the three-artifact gate first.'] };
  }
  if (manifest.schema !== 'qms-release-artifacts@1' || manifest.ok !== true) {
    errors.push('release manifest is missing or not marked ok.');
  }
  if (manifest.version !== release.version || manifest.tag !== tag) {
    errors.push('release manifest version/tag does not match ' + release.version + '/' + tag + '.');
  }
  let sums = '';
  try {
    sums = await readFile(path.join(releaseDir, 'SHA256SUMS'), 'utf8');
  } catch {
    errors.push('release/SHA256SUMS is missing.');
  }
  for (const kind of REQUIRED_ARTIFACT_KINDS) {
    const file = releaseArtifactPaths(repoRoot, release)[kind];
    const entry = manifest.artifacts?.find((artifact) => artifact.kind === kind);
    if (!entry) {
      errors.push('manifest has no entry for ' + kind + '.');
      continue;
    }
    if (!(await exists(file))) {
      errors.push('installable artifact is missing: ' + file);
      continue;
    }
    const info = await stat(file);
    const sha256 = await sha256File(file);
    if (info.size !== entry.bytes) errors.push(entry.name + ' size ' + info.size + ' does not match the manifest ' + entry.bytes + '.');
    if (sha256 !== entry.sha256) errors.push(entry.name + ' SHA-256 does not match the manifest.');
    if (!sums.split('\n').some((line) => line.endsWith('  ' + entry.name))) {
      errors.push('SHA256SUMS does not list ' + entry.name + '.');
    }
    if (kind === 'deb' && info.size < 30 * 1024 * 1024) errors.push('.deb is implausibly small.');
  }
  return { ok: errors.length === 0, errors, manifest };
}

export async function checkPackagedAcceptance({ repoRoot = REPO_ROOT }) {
  const errors = [];
  const releaseDir = path.join(repoRoot, 'release');
  const functional = await readJson(path.join(releaseDir, 'packaged-functional-acceptance.json')).catch(() => null);
  const handoff = await readJson(path.join(releaseDir, 'packaged-handoff-e2e.json')).catch(() => null);
  const required = ['A', 'B', 'C', 'D', 'E', 'F', 'G1', 'G2', 'G3', 'G4', 'I', 'J'];
  if (functional?.status !== 'pass') {
    errors.push('packaged functional acceptance evidence is missing or not pass.');
  } else {
    for (const control of required) {
      if (functional.controls?.[control]?.status !== 'PASS') errors.push('packaged control ' + control + ' is not PASS.');
    }
  }
  const receipt = handoff?.stages?.receiptVerify;
  if (handoff?.status !== 'pass') {
    errors.push('packaged handoff evidence is missing or not pass.');
  } else if (!receipt || !(receipt.resources > 0) || !(receipt.remoteVerifiedRows >= receipt.resources)) {
    errors.push('handoff receipt/read-back did not verify every resource.');
  } else if (receipt.importClaimedVerification !== false) {
    errors.push('receipt import was treated as verification proof.');
  }
  return { ok: errors.length === 0, errors };
}

export async function runDeliveryGates({ repoRoot = REPO_ROOT, stage = 'prepublish', tag = null } = {}) {
  const release = await readJson(path.join(repoRoot, 'qms-release.json'));
  const resolvedTag = tag ?? releaseTag(release);
  const checks = {};
  checks.uniqueVersion = await checkUniqueVersion({ repoRoot, release, tag: resolvedTag, stage });
  checks.docs = await checkReleaseDocs({ repoRoot, release });
  if (stage === 'prepublish') {
    checks.installableArtifacts = await checkInstallableArtifacts({ repoRoot, release, tag: resolvedTag });
    checks.packagedAcceptance = await checkPackagedAcceptance({ repoRoot });
  }
  const errors = Object.values(checks).flatMap((check) => check.errors);
  const report = {
    schema: 'qms-delivery-gate@1',
    version: release.version,
    tag: resolvedTag,
    stage,
    checks: Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, { ok: value.ok, errors: value.errors }])),
    ok: errors.length === 0,
    checkedAt: new Date().toISOString()
  };
  await writeFile(
    path.join(repoRoot, 'release', 'delivery-gate.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
  return report;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const stage = process.argv.find((value) => value.startsWith('--stage='))?.slice('--stage='.length) ?? 'prepublish';
  const tag = process.argv.find((value) => value.startsWith('--tag='))?.slice('--tag='.length) ?? null;
  if (!['prebuild', 'prepublish'].includes(stage)) {
    console.error('unknown delivery-gate stage: ' + stage);
    process.exit(1);
  }
  const report = await runDeliveryGates({ stage, tag });
  if (!report.ok) {
    console.error('DELIVERY GATE FAILED (' + stage + '):');
    for (const [name, check] of Object.entries(report.checks)) {
      for (const error of check.errors) console.error(' - ' + name + ': ' + error);
    }
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, version: report.version, tag: report.tag, stage: report.stage }, null, 2));
}
