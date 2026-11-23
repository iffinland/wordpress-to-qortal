import { createReadStream } from 'node:fs';
import { mkdir, readdir, lstat, mkdtemp, rm, rename, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as tar from 'tar';
import { atomicWriteJson } from './storage/atomic.js';
import { assertProjectId, projectPaths } from './storage/paths.js';

const MANIFEST = 'qms-project-backup.json';
async function hash(file) { const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex'); }
function safe(name) {
  const value = name.replace(/^\.\//, '').replace(/\/$/, '');
  if (!value || value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => part === '..' || part === '.') || /[\x00-\x1f]/.test(value)) throw new Error('Unsafe backup path.');
  return value;
}
export async function createProjectBackup(handle, file) {
  if (handle.runs.list().some((run) => run.state === 'running')) throw new Error('Pause active operations before saving a backup.');
  const files = [];
  const manifest = { schema: 'qms-project-backup@1', projectId: handle.project.id, siteId: handle.project.identity.siteId, createdAt: new Date().toISOString(), files: [] };
  async function walk(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (relative === MANIFEST || relative === 'lock.json' || /(^|\/)(?:project\.lock|\.lock)$/.test(relative) || relative.endsWith('.tmp')) continue;
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error('Backups cannot include symbolic links.');
      if (info.isDirectory()) await walk(absolute, relative);
      else if (info.isFile()) { safe(relative); files.push(relative); manifest.files.push({ path: relative, bytes: info.size, sha256: await hash(absolute) }); }
    }
  }
  const destination = path.resolve(file);
  if (destination.startsWith(handle.paths.root + path.sep)) throw new Error('Save the backup outside this project folder.');
  await walk(handle.paths.root);
  await atomicWriteJson(path.join(handle.paths.root, MANIFEST), manifest, { mode: 0o600 });
  const temporary = destination + '.tmp';
  try {
    await tar.c({ gzip: true, file: temporary, cwd: handle.paths.root, portable: true, noMtime: true, follow: false }, [MANIFEST, ...files]);
    // Source operations must remain quiescent throughout the snapshot.
    for (const entry of manifest.files) if (await hash(path.join(handle.paths.root, entry.path)) !== entry.sha256) throw new Error('Project changed while saving. Pause operations and try again.');
    await rename(temporary, destination);
    return { path: destination, bytes: (await lstat(destination)).size, sha256: await hash(destination), files: files.length };
  } finally { await rm(temporary, { force: true }); await rm(path.join(handle.paths.root, MANIFEST), { force: true }); }
}
export async function restoreProjectBackup(dataRoot, file) {
  const seen = new Set();
  let bytes = 0;
  let invalid = null;
  await tar.t({ file, strict: true, onReadEntry(entry) {
    try {
      const name = safe(entry.path);
      if (!['File', 'Directory'].includes(entry.type)) throw new Error('Backup contains links or special files.');
      if (seen.has(name)) throw new Error('Backup contains duplicate paths.');
      seen.add(name); bytes += entry.size;
      if (seen.size > 200000 || bytes > 100 * 1024 ** 3) throw new Error('Backup exceeds safety limits.');
    } catch (error) { invalid = error; }
  } });
  if (invalid) throw invalid;
  if (!seen.has(MANIFEST) || !seen.has('project.json')) throw new Error('This is not a QMS project backup.');
  const projects = path.join(dataRoot, 'projects');
  await mkdir(projects, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(path.join(projects, '.restore-'));
  try {
    await tar.x({ file, cwd: temporary, strict: true, preservePaths: false, noChmod: true, noMtime: true,
      filter(name, entry) { safe(name); if (!['File', 'Directory'].includes(entry.type)) throw new Error('Backup contains links or special files.'); return true; }
    });
    const manifest = JSON.parse(await readFile(path.join(temporary, MANIFEST), 'utf8'));
    if (manifest.schema !== 'qms-project-backup@1' || !Array.isArray(manifest.files)) throw new Error('Unsupported backup format.');
    assertProjectId(manifest.projectId);
    const listed = new Set();
    for (const entry of manifest.files) {
      const name = safe(entry.path);
      if (listed.has(name)) throw new Error('Duplicate backup manifest path.');
      listed.add(name);
      const target = path.join(temporary, name);
      const info = await lstat(target);
      if (!info.isFile() || info.size !== entry.bytes || await hash(target) !== entry.sha256) throw new Error('Backup integrity check failed: ' + name);
    }
    for (const name of seen) {
      const info = await lstat(path.join(temporary, name));
      if (info.isFile() && name !== MANIFEST && !listed.has(name)) throw new Error('Backup contains an unlisted file.');
    }
    const project = JSON.parse(await readFile(path.join(temporary, 'project.json'), 'utf8'));
    if (project.id !== manifest.projectId || project.identity?.siteId !== manifest.siteId) throw new Error('Backup identity does not match its manifest.');
    const destination = projectPaths(dataRoot, project.id).root;
    try { await lstat(destination); throw Object.assign(new Error('This project already exists. Open a different workspace to restore it without replacing your current project.'), { code: 'BACKUP_PROJECT_EXISTS' }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rm(path.join(temporary, MANIFEST));
    // Project files can contain absolute paths in old runtime caches; source
    // of truth (project identity, hashes and journals) is preserved verbatim.
    await rename(temporary, destination);
    return { restored: true, projectId: project.id, name: project.name, files: listed.size };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
