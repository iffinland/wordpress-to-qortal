#!/usr/bin/env node
/**
 * Merge per-distribution install evidence into one INSTALL-VERIFICATION.json.
 * This file is installation/runtime evidence and is deliberately separate from
 * RELEASE-STATE.json.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT, artifactName, readJson, sha256File } from './lib.mjs';
import { componentVersion } from './artifact-set.mjs';

const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const config = await readJson(path.join(REPO_ROOT, 'desktop/release.config.json'));
const desktopVersion = componentVersion(release, 'desktop');
const artifact = path.join(REPO_ROOT, 'desktop/release', artifactName(config.packageName, desktopVersion, release.architecture));
const inputs = process.argv.slice(2).filter((value) => value.startsWith('--input=')).map((value) => path.resolve(value.slice('--input='.length)));
if (inputs.length < 2) {
  console.error('usage: merge-install-evidence.mjs --input=<trixie.json> --input=<bookworm.json> [--out=<file>]');
  process.exit(2);
}
const environments = [];
for (const input of inputs) environments.push(await readFile(input, 'utf8').then(JSON.parse));
const outArg = process.argv.find((value) => value.startsWith('--out='));
const output = outArg ? path.resolve(outArg.slice('--out='.length)) : path.join(REPO_ROOT, 'desktop/release/INSTALL-VERIFICATION.json');
const sha256 = await sha256File(artifact);

const summary = {
  schema: 'qms-install-verification@1',
  artifact: path.basename(artifact),
  version: desktopVersion,
  sha256,
  status: environments.every((entry) => entry.status === 'pass') ? 'pass' : 'fail',
  environments: environments.map((entry) => ({
    distro: entry.distro,
    status: entry.status,
    method: entry.method,
    isolation: entry.isolation,
    packageInstall: entry.executed.packageInstall,
    packageLayout: entry.executed.packageLayout,
    guiSmoke: entry.executed.guiSmoke,
    guiSmokeOutput: entry.guiSmokeOutput,
    engineFlows: entry.executed.engineFlows,
    engineSteps: entry.engineSteps,
    projectDataCreated: entry.executed.projectDataCreated,
    removal: entry.executed.removal,
    dataSurvivedRemoval: entry.executed.dataSurvivedRemoval,
    reinstall: entry.executed.reinstall,
    dataSurvivedReinstall: entry.executed.dataSurvivedReinstall,
    projectReadAfterReinstall: entry.executed.projectReadAfterReinstall,
    keyring: entry.keyring,
    steps: entry.steps,
    limitations: entry.limitations
  })),
  harnessNotes: [
    'The disposable rootfs pre-creates messagebus and staff groups with GID 0 and uses a no-op adduser wrapper because a single-UID user namespace cannot map service-account GIDs during dpkg postinst scripts.',
    'Package installation, dpkg database state, Xvfb launch and engine execution are real; only host systemd service startup is absent.'
  ],
  unverifiedGates: [
    {
      gate: 'MX Linux 23 install',
      status: 'unverified',
      reason: 'No supported MX Linux test rootfs/VM was available on this host. The package is Debian 12 based-compatible; Debian 12 install is verified.'
    },
    {
      gate: 'Full graphical desktop session',
      status: 'partial',
      reason: 'The real Electron app was launched against a real Xvfb X server. Desktop-menu click, window manager integration and a real login-keyring prompt were not exercised.'
    },
    {
      gate: 'GNOME Keyring unlock prompt',
      status: 'partial',
      reason: 'A headless D-Bus secret-tool store/lookup was attempted per distribution; the result is recorded in each environment. A graphical unlock prompt requires a full session.'
    },
    {
      gate: 'AC9.7 live Qortal-network validation',
      status: 'blocked',
      reason: 'Requires explicit owner authorization for the chosen Qortal network. This build performs no QDN publication, signing, wallet access or live network validation.'
    }
  ],
  generatedAt: new Date().toISOString()
};
await writeFile(output, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ status: summary.status, environments: summary.environments.map((entry) => entry.distro + ':' + entry.status), output }, null, 2));
if (summary.status !== 'pass') process.exit(1);
