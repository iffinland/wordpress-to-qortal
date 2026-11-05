#!/usr/bin/env node
/**
 * Run the isolated Debian install test inside user + PID + mount namespaces.
 * The host kernel and host services are never modified; all mounts are private.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT, readJson, sha256File } from './lib.mjs';
import { componentVersion } from './artifact-set.mjs';

function argument(name) {
  const entry = process.argv.find((value) => value.startsWith('--' + name + '='));
  return entry ? entry.slice(('--' + name + '=').length) : null;
}
const rootfs = path.resolve(argument('rootfs') ?? '');
const distro = argument('distro') ?? path.basename(rootfs);
const deb = path.resolve(argument('deb') ?? path.join(REPO_ROOT, 'desktop/release/qortal-migration-studio_0.6.0_amd64.deb'));
const out = path.resolve(argument('out') ?? path.join(REPO_ROOT, 'desktop/release/install-' + distro + '.json'));
if (!argument('rootfs')) {
  console.error('usage: install-test.mjs --rootfs=<dir> --distro=<label> [--deb=<file>] [--out=<file>]');
  process.exit(2);
}

const startedAt = new Date().toISOString();
// A single-UID user namespace maps only one host UID. System package postinst
// scripts chown to service groups such as messagebus; collapse that group to
// GID 0 in the disposable rootfs so dpkg-statoverride can succeed.
const groupFile = path.join(rootfs, 'etc/group');
let groupBody = await readFile(groupFile, 'utf8');
for (const group of ['messagebus', 'staff']) {
  if (!new RegExp('^' + group + ':', 'm').test(groupBody)) {
    groupBody += group + ':x:0:\n';
  } else {
    groupBody = groupBody.replace(new RegExp('^' + group + ':x:[0-9]+:', 'm'), group + ':x:0:');
  }
}
await writeFile(groupFile, groupBody);
// System postinst scripts call adduser for service users. In a single-UID
// namespace their gids are unmapped, so the disposable rootfs gets a no-op
// adduser wrapper and a pre-created messagebus group with GID 0.
const adduserWrapper = path.join(rootfs, 'usr/sbin/adduser');
await mkdir(path.dirname(adduserWrapper), { recursive: true });
await writeFile(adduserWrapper, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const gshadowFile = path.join(rootfs, 'etc/gshadow');
try {
  const shadowBody = await readFile(gshadowFile, 'utf8');
  if (!/^messagebus:/m.test(shadowBody)) {
    await writeFile(gshadowFile, shadowBody + 'messagebus:!*::\n');
  } else {
    await writeFile(gshadowFile, shadowBody.replace(/^messagebus:[^:]*:[^:]*:/m, 'messagebus:!*:0:'));
  }
} catch { /* optional file */ }
const resultFile = path.join(rootfs, 'tmp/qms-result.txt');
await rm(resultFile, { force: true }).catch(() => {});
const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const desktopVersion = componentVersion(release, 'desktop');
const debInfo = await stat(deb);
const debSha = await sha256File(deb);

const env = {
  ...process.env,
  QMS_ROOTFS: rootfs,
  QMS_DISTRO: distro,
  QMS_DEB: deb,
  QMS_SMOKE_DIR: path.join(REPO_ROOT, 'test-support/phase9')
};
const child = spawnSync('unshare', [
  '-rmpf',
  '--mount-proc=' + path.join(rootfs, 'proc'),
  'bash',
  path.join(REPO_ROOT, 'scripts/release/chroot-install.sh')
], {
  env,
  encoding: 'utf8',
  timeout: 45 * 60 * 1000,
  maxBuffer: 20 * 1024 * 1024
});
const stdout = String(child.stdout ?? '');
const stderr = String(child.stderr ?? '');
const steps = stdout.split('\n').filter((line) => line.startsWith('STEP_OK ')).map((line) => line.slice(8).trim());
const failures = stdout.split('\n').filter((line) => line.startsWith('STEP_FAIL ')).map((line) => line.slice(9).trim());
let rawResult = '';
try {
  rawResult = await readFile(resultFile, 'utf8');
} catch {
  rawResult = '';
}
const resultLines = Object.fromEntries(rawResult.split('\n')
  .filter((line) => line.startsWith('RESULT '))
  .map((line) => {
    const body = line.slice(7);
    const index = body.indexOf('=');
    return index === -1 ? [body, ''] : [body.slice(0, index), body.slice(index + 1)];
  }));
const keyring = rawResult.split('\n').find((line) => line.startsWith('KEYRING_')) ?? 'KEYRING_NOT_TESTED';

const ok = child.status === 0 && failures.length === 0 && resultLines.status === 'pass';
const evidence = {
  schema: 'qms-install-environment@1',
  distro,
  distribution: distro,
  artifact: path.basename(deb),
  artifactBytes: debInfo.size,
  artifactSha256: debSha,
  version: desktopVersion,
  method: 'isolated debootstrap-style Debian rootfs; apt-get install of the local .deb; real dpkg database; Xvfb X server',
  isolation: 'user + PID + mount namespaces (unshare -rmpf); no host services or host package database modified',
  executed: {
    packageInstall: steps.includes('package_installed'),
    packageLayout: steps.includes('package_layout_verified'),
    guiSmoke: steps.includes('electron_gui_smoke'),
    engineFlows: steps.includes('engine_primary_flows'),
    projectDataCreated: steps.includes('project_data_created'),
    removal: steps.includes('package_removed'),
    dataSurvivedRemoval: steps.includes('project_data_survived_removal'),
    reinstall: steps.includes('package_reinstalled'),
    dataSurvivedReinstall: steps.includes('same_version_reinstall_preserved_data'),
    projectReadAfterReinstall: steps.includes('existing_project_read_after_reinstall')
  },
  guiSmokeOutput: resultLines.gui_smoke ?? null,
  engineSteps: Number(resultLines.engine_steps ?? 0),
  installedVersion: resultLines.installed_version ?? null,
  keyring,
  steps,
  failures,
  status: ok ? 'pass' : 'fail',
  exitCode: child.status,
  stderr: stderr.slice(-4000),
  stdoutTail: stdout.slice(-8000),
  limitations: [
    'Headless X11 (Xvfb), not a complete desktop session or desktop-menu click.',
    'Application runs as root inside the single-UID user namespace; --no-sandbox is used for Chromium because the namespace cannot provide a privileged setuid sandbox helper.',
    'GNOME Keyring unlock depends on a headless D-Bus session and may not represent a real graphical login keyring.'
  ],
  startedAt,
  finishedAt: new Date().toISOString()
};
await writeFile(out, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ distro, status: evidence.status, steps: steps.length, engineSteps: evidence.engineSteps, keyring, exitCode: child.status, output: out }, null, 2));
if (!ok) {
  console.error(stderr.slice(-2000));
  console.error(stdout.slice(-4000));
  process.exit(1);
}
