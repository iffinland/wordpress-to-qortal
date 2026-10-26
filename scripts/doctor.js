import 'dotenv/config';
import { access, mkdir, statfs } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const checks = [];

function pass(label, detail = '') {
  checks.push({ level: 'PASS', label, detail });
}

function warn(label, detail = '') {
  checks.push({ level: 'WARN', label, detail });
}

function fail(label, detail = '') {
  checks.push({ level: 'FAIL', label, detail });
}

async function checkQortal(nodeUrl, name) {
  let status;
  try {
    const response = await fetch(`${nodeUrl}/admin/status`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    status = await response.json();
    pass('Qortal node', `${nodeUrl} is reachable`);
    if (status.isSynchronizing || Number(status.syncPercent) < 100) {
      warn('Qortal sync', `Node is at ${status.syncPercent ?? 'unknown'}%`);
    } else {
      pass('Qortal sync', '100%');
    }
  } catch (error) {
    warn('Qortal node', `${nodeUrl} is not reachable (${error.message}). Open Qortal Hub before running batch:init.`);
    return;
  }

  for (const identifier of ['cr-qdn-manifest', 'cms-manifest']) {
    try {
      const response = await fetch(
        `${nodeUrl}/arbitrary/DOCUMENT/${encodeURIComponent(name)}/${encodeURIComponent(identifier)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      pass(`QDN ${identifier}`, `Found under ${name}`);
    } catch (error) {
      warn(`QDN ${identifier}`, `Not readable yet under ${name} (${error.message})`);
    }
  }
}

async function main() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor >= 20) pass('Node.js', process.version);
  else fail('Node.js', `${process.version} found; version 20 or newer is required`);

  const envPath = path.resolve('.env');
  try {
    await access(envPath);
    pass('.env', 'File exists');
  } catch {
    fail('.env', 'Missing. Run bash scripts/setup-linux.sh or copy .env.example to .env.');
  }

  const baseUrl = process.env.WORDPRESS_BASE_URL?.trim();
  if (baseUrl === 'https://corbettreport.com') pass('WordPress URL', baseUrl);
  else if (baseUrl) warn('WordPress URL', `${baseUrl} is set; expected https://corbettreport.com`);
  else fail('WordPress URL', 'WORDPRESS_BASE_URL is missing');

  const authMode = process.env.WORDPRESS_AUTH_MODE?.trim().toLowerCase() || 'application_password';
  const username = process.env.WORDPRESS_USERNAME?.trim();
  const hasPassword = Boolean(process.env.WORDPRESS_PASSWORD?.trim());
  const hasAppPassword = Boolean(process.env.WORDPRESS_APP_PASSWORD?.trim());
  if (!username) fail('WordPress login', 'WORDPRESS_USERNAME is missing');
  else pass('WordPress login', `${username} (${authMode})`);
  if (authMode === 'session' && !hasPassword) fail('WordPress password', 'WORDPRESS_PASSWORD is missing for session login');
  if (authMode === 'application_password' && !hasAppPassword) {
    fail('WordPress app password', 'WORDPRESS_APP_PASSWORD is missing for application-password login');
  }
  if (authMode === 'session' && hasPassword) pass('WordPress password', 'Configured (value hidden)');
  if (authMode === 'application_password' && hasAppPassword) pass('WordPress app password', 'Configured (value hidden)');

  const contentName = process.env.QORTAL_CONTENT_NAME?.trim() || 'Corbett';
  if (contentName === 'Corbett') pass('Content Qortal name', contentName);
  else warn('Content Qortal name', `${contentName} is set; existing Corbett Report content is under Corbett`);

  const nodeUrl = (process.env.QORTAL_NODE_URL?.trim() || 'http://localhost:12391').replace(/\/+$/, '');
  await checkQortal(nodeUrl, contentName);

  try {
    await mkdir(path.resolve(process.env.OUTPUT_DIR?.trim() || 'wp-qortal-import'), { recursive: true });
    const stats = await statfs(path.resolve('.'));
    const freeGb = (Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3;
    pass('Output folder', 'Writable');
    if (freeGb >= 10) pass('Free disk space', `${freeGb.toFixed(1)} GB available`);
    else warn('Free disk space', `${freeGb.toFixed(1)} GB available; media imports need plenty of space`);
  } catch (error) {
    fail('Output folder', error.message);
  }

  console.log('');
  console.log('Corbett Report setup check');
  console.log('');
  for (const check of checks) {
    console.log(`${check.level.padEnd(4)}  ${check.label.padEnd(24)} ${check.detail}`);
  }
  console.log('');

  const failures = checks.filter((check) => check.level === 'FAIL').length;
  const warnings = checks.filter((check) => check.level === 'WARN').length;
  console.log(`Result: ${failures} failed, ${warnings} warning(s)`);
  console.log('');
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error('');
  console.error('Setup check failed');
  console.error(error.message);
  process.exitCode = 1;
});
