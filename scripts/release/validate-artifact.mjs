#!/usr/bin/env node
/**
 * Offline validation of a built .deb: metadata, payload layout, permissions,
 * bundled engine/template integrity and absence of development-only material.
 */
import { mkdtemp, readFile, readdir, readlink, rm, stat, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO_ROOT, artifactName, capture, readJson, sha256File, writeJson } from './lib.mjs';
import { checkVersions } from '../qms-release.mjs';
import { componentVersion } from './artifact-set.mjs';

const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const config = await readJson(path.join(REPO_ROOT, 'desktop/release.config.json'));
const desktopVersion = componentVersion(release, 'desktop');
const cmsVersion = componentVersion(release, 'cms');
const artifactArg = process.argv.find((value) => value.startsWith('--artifact='));
const artifact = artifactArg
  ? path.resolve(artifactArg.slice('--artifact='.length))
  : path.join(REPO_ROOT, 'desktop/release', artifactName(config.packageName, desktopVersion, release.architecture));
const expectVersion = process.argv.find((value) => value.startsWith('--version='))?.slice('--version='.length) ?? desktopVersion;

const checks = [];
function check(name, ok, detail = null) {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) throw new Error('validation failed: ' + name + (detail ? ' (' + detail + ')' : ''));
}

await stat(artifact);
const info = await stat(artifact);
check('artifact name follows Debian convention', path.basename(artifact) === artifactName(config.packageName, desktopVersion, release.architecture), path.basename(artifact));
check('artifact is a plausible Electron package size', info.size > 30 * 1024 * 1024, String(info.size));
const sha256 = await sha256File(artifact);

const control = capture('dpkg-deb', ['-f', artifact]).replace(/\n[ \t]+/g, ' ');
const fields = Object.fromEntries(
  control.split('\n')
    .filter((line) => /^[A-Za-z-]+: /.test(line))
    .map((line) => {
      const index = line.indexOf(': ');
      return [line.slice(0, index), line.slice(index + 2)];
    })
);
check('package name', fields.Package === config.packageName, fields.Package);
check('package version', fields.Version === expectVersion || fields.Version === expectVersion.replace(/-/g, '~'), fields.Version);
check('package architecture', fields.Architecture === 'amd64', fields.Architecture);
check('package section', fields.Section === config.section, fields.Section);
check('maintainer present', Boolean(fields.Maintainer), fields.Maintainer);
check('homepage present', fields.Homepage === config.homepage, fields.Homepage);
check('installed size present', Number(fields['Installed-Size']) > 1000, fields['Installed-Size']);
check('GTK dependency alternatives', /libgtk-3-0/.test(fields.Depends ?? ''), fields.Depends);
check('libsecret dependency', /libsecret-1-0/.test(fields.Depends ?? ''));
check('xdg-utils dependency', /xdg-utils/.test(fields.Depends ?? ''));

const contents = capture('dpkg-deb', ['-c', artifact]);
const lines = contents.split('\n').filter(Boolean);
const packagedPaths = new Set();
for (const line of lines) {
  const match = /\s(\.\/\S+?)(?:\s+->.*)?$/.exec(line);
  if (match) packagedPaths.add(match[1]);
}
const requiredPaths = [
  './' + config.installationRoot.replace(/^\//, '') + '/' + config.executableName,
  './' + config.installationRoot.replace(/^\//, '') + '/resources/app.asar',
  './' + config.installationRoot.replace(/^\//, '') + '/resources/engine/bin/qms-host.js',
  './' + config.installationRoot.replace(/^\//, '') + '/resources/engine/node_modules/cheerio/package.json',
  './' + config.installationRoot.replace(/^\//, '') + '/resources/engine/node_modules/dotenv/package.json',
  './' + config.installationRoot.replace(/^\//, '') + '/resources/engine/templates/generic-cms/dist/index.html',
  './' + config.installationRoot.replace(/^\//, '') + '/resources/engine/templates/generic-cms/template.json',
  './usr/share/applications/' + config.packageName + '.desktop',
  './usr/bin/' + config.executableName,
  './usr/share/doc/' + config.packageName + '/copyright'
];
for (const required of requiredPaths) {
  check('contains ' + required, packagedPaths.has(required), null);
}
for (const size of ['16x16', '32x32', '48x48', '64x64', '128x128', '256x256', '512x512']) {
  check('contains icon ' + size, packagedPaths.has('./usr/share/icons/hicolor/' + size + '/apps/' + config.packageName + '.png'));
}

const forbidden = [
  /\/profiles\//,
  /\/\.env$/,
  /\/fixtures\//,
  /\/test\//,
  /\/tests\//,
  /\/test-support\//,
  /\/corbettreport\//,
  /\/viewer\/node_modules\//,
  /\.map$/,
  /\/\.git\//,
  /\/release\//
];
for (const pattern of forbidden) {
  const matches = lines.filter((line) => pattern.test(line));
  check('no forbidden path ' + pattern, matches.length === 0, matches.slice(0, 3).join(' | '));
}

const extractRoot = await mkdtemp(path.join(tmpdir(), 'qms-deb-validate-'));
try {
  capture('dpkg-deb', ['-x', artifact, extractRoot]);
  const installDir = path.join(extractRoot, config.installationRoot.replace(/^\//, ''));
  const executable = path.join(installDir, config.executableName);
  const executableInfo = await stat(executable);
  check('main executable is executable', (executableInfo.mode & 0o111) !== 0, executableInfo.mode.toString(8));
  const sandbox = path.join(installDir, 'chrome-sandbox');
  const sandboxInfo = await stat(sandbox);
  check('chrome-sandbox is setuid root', (sandboxInfo.mode & 0o4000) !== 0, sandboxInfo.mode.toString(8));
  check('chrome-sandbox mode is 4755', (sandboxInfo.mode & 0o7777) === 0o4755, sandboxInfo.mode.toString(8));

  const desktopFile = await readFile(path.join(extractRoot, 'usr/share/applications', config.packageName + '.desktop'), 'utf8');
  check('desktop entry name', /^Name=Qortal Migration Studio$/m.test(desktopFile));
  check('desktop entry exec', desktopFile.includes('Exec=' + config.installationRoot + '/' + config.executableName));
  check('desktop entry icon', /^Icon=qortal-migration-studio$/m.test(desktopFile));
  check('desktop entry not terminal', /^Terminal=false$/m.test(desktopFile));

  const engineRoot = path.join(installDir, 'resources', 'engine');
  const manifest = JSON.parse(await readFile(path.join(engineRoot, 'engine-runtime.json'), 'utf8'));
  check('engine runtime schema', manifest.schema === 'qms-engine-runtime@1', manifest.schema);
  check('engine runtime version', manifest.version === expectVersion, manifest.version);
  check('engine runtime template version', manifest.template?.version === cmsVersion, manifest.template?.version);
  let hashFailures = 0;
  for (const entry of manifest.files) {
    const absolute = path.join(engineRoot, entry.path);
    const body = await readFile(absolute);
    const digest = createHash('sha256').update(body).digest('hex');
    if (digest !== entry.sha256 || body.length !== entry.bytes) hashFailures += 1;
  }
  check('engine runtime file hashes match manifest', hashFailures === 0, String(hashFailures));

  const templateMeta = JSON.parse(await readFile(path.join(engineRoot, 'templates/generic-cms/template.json'), 'utf8'));
  check('bundled template schema', templateMeta.schema === 'qms-bundled-template@1');
  check('bundled template version', templateMeta.version === cmsVersion, templateMeta.version);
  check('bundled template has root index.html', (await stat(path.join(engineRoot, 'templates/generic-cms/dist/index.html'))).size > 0);

  const asarApi = path.join(REPO_ROOT, 'desktop/node_modules/@electron/asar');
  const appPackage = JSON.parse(capture(process.execPath, ['-e', "const asar=require(process.argv[1]);process.stdout.write(asar.extractFile(process.argv[2],'package.json'))", asarApi, path.join(installDir, 'resources/app.asar')]));
  check('asar package version', appPackage.version === expectVersion, appPackage.version);

  const binLink = path.join(extractRoot, 'usr/bin', config.executableName);
  const linkInfo = await lstat(binLink);
  check('usr/bin launcher is a symlink', linkInfo.isSymbolicLink());
  check('usr/bin launcher target', await readlink(binLink) === config.installationRoot + '/' + config.executableName);

  const modes = [];
  async function checkModes(current) {
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      const absolute = path.join(current, child.name);
      if (child.isDirectory()) {
        await checkModes(absolute);
      } else if (child.isFile()) {
        const childInfo = await stat(absolute);
        if ((childInfo.mode & 0o002) !== 0) modes.push(absolute + ' world-writable');
        if ((childInfo.mode & 0o4000) !== 0 && !absolute.endsWith('/chrome-sandbox')) modes.push(absolute + ' unexpected setuid');
      }
    }
  }
  await checkModes(extractRoot);
  check('no unsafe permissions', modes.length === 0, modes.slice(0, 5).join(' | '));

  const controlDir = await mkdtemp(path.join(tmpdir(), 'qms-deb-control-'));
  try {
    capture('dpkg-deb', ['-e', artifact, controlDir]);
    const prerm = await readFile(path.join(controlDir, 'prerm'), 'utf8').catch(() => '');
    const postinst = await readFile(path.join(controlDir, 'postinst'), 'utf8').catch(() => '');
    check('maintainer scripts never delete project data', !/\brm\b|\bdelete\b|XDG_DATA_HOME\/.*rm/.test(prerm + '\n' + postinst));
    check('prerm has no destructive command', !/rm -rf|rm -f/.test(prerm));
  } finally {
    await rm(controlDir, { recursive: true, force: true });
  }
} finally {
  await rm(extractRoot, { recursive: true, force: true });
}

const record = {
  schema: 'qms-deb-validation@1',
  artifact: path.basename(artifact),
  bytes: info.size,
  sha256,
  version: expectVersion,
  architecture: 'amd64',
  checks: checks.length,
  passed: checks.filter((entry) => entry.ok).length,
  failed: checks.filter((entry) => !entry.ok).length,
  results: checks,
  validatedAt: new Date().toISOString()
};
await writeJson(path.join(REPO_ROOT, 'desktop/release/validation.json'), record);
console.log('artifact validation passed: ' + checks.length + ' checks');
console.log(JSON.stringify({ artifact: record.artifact, bytes: record.bytes, sha256, checks: record.checks }, null, 2));

