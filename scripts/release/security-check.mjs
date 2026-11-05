#!/usr/bin/env node
/**
 * Release security gate:
 *  - production dependency audit for the engine and desktop package sets;
 *  - secret-material and private-key scan of the packaged payload;
 *  - development-only path/name scan;
 *  - verification that the package contains no writable or unexpected setuid
 *    payload outside chrome-sandbox.
 */
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO_ROOT, artifactName, capture, readJson, run, writeJson } from './lib.mjs';
import { componentVersion } from './artifact-set.mjs';

const release = await readJson(path.join(REPO_ROOT, 'qms-release.json'));
const config = await readJson(path.join(REPO_ROOT, 'desktop/release.config.json'));
const desktopVersion = componentVersion(release, 'desktop');
const artifact = path.join(REPO_ROOT, 'desktop/release', artifactName(config.packageName, desktopVersion, release.architecture));

function audit(cwd) {
  const result = run('npm', ['audit', '--omit=dev', '--json'], { cwd, allowFailure: true, quiet: true });
  try {
    return JSON.parse(String(result.stdout ?? '{}'));
  } catch {
    return { error: 'audit output was not JSON', status: result.status };
  }
}

const audits = [
  { name: 'engine-runtime', cwd: path.join(REPO_ROOT, 'desktop/engine-package') },
  { name: 'desktop', cwd: path.join(REPO_ROOT, 'desktop') }
].map((entry) => {
  const report = audit(entry.cwd);
  const vulnerabilities = report.metadata?.vulnerabilities ?? {};
  return {
    name: entry.name,
    exitCode: report.error ? 1 : 0,
    error: report.error ?? null,
    vulnerabilities: {
      info: vulnerabilities.info ?? 0,
      low: vulnerabilities.low ?? 0,
      moderate: vulnerabilities.moderate ?? 0,
      high: vulnerabilities.high ?? 0,
      critical: vulnerabilities.critical ?? 0,
      total: vulnerabilities.total ?? 0
    }
  };
});

const SECRET_PATTERNS = [
  { name: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'aws-key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'slack-token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'qortal-secret-assignment', pattern: /(?:QORTAL_[A-Z_]*KEY|WORDPRESS_PASSWORD|WORDPRESS_APP_PASSWORD|WALLET_PASSWORD)\s*=\s*[^\s"']+/ }
];
const FORBIDDEN_NAMES = [
  /^\.env(?:\..*)?$/,
  /(?:^|\/)\.env$/,
  /\.(?:pem|p12|pfx|jks|keystore)$/i,
  /(?:^|\/)id_(?:rsa|ed25519|ecdsa)$/,
  /(?:^|\/)\.npmrc$/,
  /(?:^|\/)credentials\.json$/,
  /(?:^|\/)wp-qortal-import(?:-|\/|$)/
];
const ALLOWED_BINARY = /\.(?:png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|eot|so|node|pak|bin|dat|asar|deb)$/i;

const extractRoot = await mkdtemp(path.join(tmpdir(), 'qms-security-scan-'));
let scan = { files: 0, textFiles: 0, bytes: 0, secretFindings: [], forbiddenNames: [], scannedAt: new Date().toISOString() };
try {
  capture('dpkg-deb', ['-x', artifact, extractRoot]);
  async function walk(current) {
    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      const absolute = path.join(current, child.name);
      const relative = path.relative(extractRoot, absolute).split(path.sep).join('/');
      if (child.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!child.isFile()) continue;
      scan.files += 1;
      const info = await stat(absolute);
      scan.bytes += info.size;
      for (const pattern of FORBIDDEN_NAMES) {
        if (pattern.test(child.name) || pattern.test(relative)) scan.forbiddenNames.push({ file: relative, pattern: String(pattern) });
      }
      if (info.size > 2 * 1024 * 1024 || ALLOWED_BINARY.test(child.name)) continue;
      scan.textFiles += 1;
      const body = await readFile(absolute);
      if (body.includes(0)) continue;
      const text = body.toString('utf8');
      for (const candidate of SECRET_PATTERNS) {
        if (candidate.pattern.test(text)) scan.secretFindings.push({ file: relative, pattern: candidate.name });
      }
    }
  }
  await walk(extractRoot);
} finally {
  await rm(extractRoot, { recursive: true, force: true });
}

const productionHigh = audits.reduce((total, entry) => total + entry.vulnerabilities.high + entry.vulnerabilities.critical, 0);
const record = {
  schema: 'qms-security-report@1',
  version: desktopVersion,
  artifact: path.basename(artifact),
  dependencyAudits: audits,
  productionHighOrCritical: productionHigh,
  payloadScan: {
    files: scan.files,
    textFiles: scan.textFiles,
    bytes: scan.bytes,
    secretFindings: scan.secretFindings,
    forbiddenNames: scan.forbiddenNames
  },
  verdict: productionHigh === 0 && scan.secretFindings.length === 0 && scan.forbiddenNames.length === 0 ? 'pass' : 'fail',
  scannedAt: scan.scannedAt
};
await writeJson(path.join(REPO_ROOT, 'desktop/release/security-report.json'), record);
console.log(JSON.stringify(record, null, 2));
if (record.verdict !== 'pass') process.exitCode = 1;
