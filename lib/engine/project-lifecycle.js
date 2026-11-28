import path from 'node:path';
import { readdir, lstat, rename, rm } from 'node:fs/promises';
import { ProjectLock } from './lock.js';
import { assertProjectDocument } from './storage/schema.js';
import { atomicWriteJson, readJsonIfExists } from './storage/atomic.js';
import { QmsError, ERROR_CODES } from './errors.js';

export async function unarchive(service, projectId) {
  const { project, paths } = await service.get(projectId);
  const lock = await ProjectLock.acquire({ file: paths.lockFile, projectId, clock: service.clock, ...service.lockOptions });
  try {
    const document = { ...project, archivedAt: null, updatedAt: service.clock.nowIso() };
    await atomicWriteJson(paths.projectFile, document);
    return { restored: true, projectId, name: document.name };
  } finally { await lock.release(); }
}
function trashPath(service, trashId) {
  if (typeof trashId !== 'string' || !/^prj_[a-z0-9][a-z0-9-]{3,47}-[0-9]{10,16}$/.test(trashId)) throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Invalid deleted project reference.');
  return path.join(service.dataRoot, 'trash', trashId);
}
async function readTrash(service, trashId) {
  const root = trashPath(service, trashId);
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Invalid deleted project folder.');
  const project = await readJsonIfExists(path.join(root, 'project.json'));
  assertProjectDocument(project, {});
  if (!trashId.startsWith(project.id + '-')) throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Deleted project identity does not match.');
  return { root, project };
}
export async function listTrash(service) {
  const entries = await readdir(path.join(service.dataRoot, 'trash'), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const output = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const { project } = await readTrash(service, entry.name);
      output.push({ trashId: entry.name, projectId: project.id, name: project.name, sourceBaseUrl: project.source?.baseUrl, targetQdnName: project.target?.qdnName, removedAt: new Date(Number(entry.name.slice(entry.name.lastIndexOf('-') + 1))).toISOString() });
    } catch { /* Unrecognized folders are never offered for removal. */ }
  }
  return output.sort((a, b) => b.removedAt.localeCompare(a.removedAt));
}
export async function restoreTrash(service, trashId) {
  const { root, project } = await readTrash(service, trashId);
  const destination = service.paths(project.id).root;
  const exists = await lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  if (exists) throw new QmsError(ERROR_CODES.PROJECT_EXISTS, 'This project is already present. Open it or restore the deleted copy in another workspace.');
  // Do not overwrite an existing directory. rename cannot replace a nonempty project.
  await rename(root, destination);
  await unarchive(service, project.id);
  return { restored: true, projectId: project.id, name: project.name };
}
export async function purgeTrash(service, trashId, confirmation) {
  const { root, project } = await readTrash(service, trashId);
  if (confirmation !== project.name) throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'Type the exact project name to permanently delete this local copy.');
  await rm(root, { recursive: true });
  return { purged: true, projectId: project.id, qdnDataPreserved: true };
}
