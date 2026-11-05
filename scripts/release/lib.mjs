import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream, readFileSync } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function run(command, args, { cwd = REPO_ROOT, env = process.env, allowFailure = false, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = quiet ? '\n' + String(result.stderr ?? '') : '';
    throw new Error(command + ' ' + args.join(' ') + ' failed with status ' + result.status + detail);
  }
  return result;
}

export function capture(command, args, { cwd = REPO_ROOT, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + ' ' + args.join(' ') + ' failed: ' + String(result.stderr ?? ''));
  }
  return String(result.stdout ?? '').trim();
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJson(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + '\n');
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(file) {
  const hash = createHash('sha256');
  const stream = createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export async function walkFiles(directory, { skip = [] } = {}) {
  const files = [];
  const skipSet = new Set(skip.map((entry) => path.resolve(entry)));
  async function walk(current, relative) {
    const children = await readdir(current, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const absolute = path.join(current, child.name);
      if (skipSet.has(absolute)) continue;
      const rel = relative ? relative + '/' + child.name : child.name;
      if (child.isDirectory()) {
        await walk(absolute, rel);
      } else if (child.isFile()) {
        const info = await stat(absolute);
        files.push({ absolute, relative: rel, bytes: info.size, mode: info.mode & 0o7777 });
      } else if (child.isSymbolicLink()) {
        throw new Error('Unexpected symlink in staged tree: ' + absolute);
      }
    }
  }
  await walk(directory, '');
  return files;
}

export function gitInfo(cwd = REPO_ROOT) {
  if (!process.env.QMS_SOURCE_COMMIT) {
    try {
      return gitInfoFromRepository(cwd);
    } catch (error) {
      if (!process.env.QMS_SOURCE_COMMIT) throw error;
    }
  }
  return {
    commit: process.env.QMS_SOURCE_COMMIT,
    tree: process.env.QMS_SOURCE_TREE ?? '',
    branch: process.env.QMS_SOURCE_BRANCH ?? 'detached',
    dirty: process.env.QMS_SOURCE_DIRTY === '1',
    status: '',
    commitTime: Number(process.env.QMS_SOURCE_EPOCH ?? 0)
  };
}

function gitInfoFromRepository(cwd) {
  const commit = capture('git', ['rev-parse', 'HEAD'], { cwd });
  const tree = capture('git', ['rev-parse', 'HEAD^{tree}'], { cwd });
  const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  const status = capture('git', ['status', '--porcelain=v1'], { cwd });
  const commitTime = Number(capture('git', ['show', '-s', '--format=%ct', 'HEAD'], { cwd }));
  return { commit, tree, branch, dirty: status.length > 0, status, commitTime };
}

export function sourceDateEpoch(git, override = null) {
  if (override && Number.isInteger(Number(override)) && Number(override) > 0) return Number(override);
  if (process.env.SOURCE_DATE_EPOCH) {
    const value = Number(process.env.SOURCE_DATE_EPOCH);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return git.commitTime;
}

export function fileModeFor(relative, mode) {
  if (relative.endsWith('/chrome-sandbox')) return 0o4755;
  if (relative.endsWith('.sh') || relative.startsWith('usr/bin/') || relative.startsWith('opt/')) {
    if (mode & 0o111) return 0o755;
  }
  return mode & 0o111 ? 0o755 : 0o644;
}

export function debVersion(version) {
  return String(version).replace(/-/g, '~');
}

export function artifactName(packageName, version, architecture) {
  // Keep the SemVer text unchanged in the file name. GitHub normalizes '~' in
  // release asset names (0.8.0~alpha.1 becomes 0.8.0.alpha.1), which would
  // break exact public-download and registry URL verification. The Debian
  // control Version still uses debVersion().
  return packageName + '_' + String(version) + '_' + architecture + '.deb';
}
