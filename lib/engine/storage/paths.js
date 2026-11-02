import os from 'node:os';
import path from 'node:path';
import { QmsError, ERROR_CODES } from '../errors.js';

export const APP_DIRECTORY_NAME = 'qortal-migration-studio';
export const PROJECT_ID_PATTERN = /^prj_[a-z0-9][a-z0-9-]{3,47}$/;

/**
 * XDG-compatible application data root.
 * Uses QMS_DATA_ROOT when set (tests and portable installs), otherwise
 * $XDG_DATA_HOME/qortal-migration-studio (~/.local/share/... by default).
 */
export function defaultDataRoot(env = process.env) {
  const override = env.QMS_DATA_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }
  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  const base = xdgDataHome && path.isAbsolute(xdgDataHome)
    ? xdgDataHome
    : path.join(os.homedir(), '.local', 'share');
  return path.join(base, APP_DIRECTORY_NAME);
}

export function assertProjectId(projectId) {
  if (typeof projectId !== 'string' || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new QmsError(ERROR_CODES.INVALID_PROJECT_ID, `Invalid project id: ${String(projectId)}`, {
      details: { projectId }
    });
  }
  return projectId;
}

export function assertPathInside(root, candidate, label = 'path') {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new QmsError(ERROR_CODES.PATH_ESCAPE, `${label} escapes the project root.`, {
      details: { root: resolvedRoot, candidate: resolvedCandidate }
    });
  }
  return resolvedCandidate;
}

export function resolveInside(root, ...segments) {
  return assertPathInside(root, path.join(root, ...segments));
}

export function projectPaths(dataRoot, projectId) {
  assertProjectId(projectId);
  const projectsDir = path.join(dataRoot, 'projects');
  const root = path.join(projectsDir, projectId);
  return {
    dataRoot,
    projectsDir,
    trashDir: path.join(dataRoot, 'trash'),
    root,
    projectFile: path.join(root, 'project.json'),
    stateDir: path.join(root, 'state'),
    snapshotFile: path.join(root, 'state', 'snapshot.json'),
    journalFile: path.join(root, 'state', 'journal.jsonl'),
    lockFile: path.join(root, 'lock.json'),
    runsDir: path.join(root, 'runs'),
    artifactsDir: path.join(root, 'artifacts')
  };
}
