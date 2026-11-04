import { createHash } from 'node:crypto';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { QmsError, ERROR_CODES } from '../errors.js';

/**
 * Shared bundle rules for multi-file QDN resources (service APP). The ZIP is
 * the exact payload submitted to Core through Qortal Hub; the member list is
 * the exact read-back contract because Core extracts the ZIP and serves each
 * file through ?filepath=.
 */
export const BUNDLE_SCHEMA = 'qms-cms-bundle@1';
export const MAX_BUNDLE_FILES = 4000;
export const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
const SAFE_MEMBER = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._@+\/-]+$/;

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
});

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

export function sha256Bytes(bytes) {
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

export function mimeFor(relativePath) {
  return MIME[path.extname(relativePath).toLowerCase()] ?? 'application/octet-stream';
}

export function normalizeMemberPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 300) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Bundle member path is invalid.');
  }
  if (!SAFE_MEMBER.test(value) || value.includes('\\') || value.includes('\u0000')) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, 'Bundle member path is unsafe: ' + value);
  }
  return value;
}

export function bundleMembers(files) {
  return files.map((file) => ({
    path: file.path,
    bytes: file.bytes.length,
    sha256: sha256Bytes(file.bytes),
    contentType: mimeFor(file.path)
  }));
}

export function zipBundle(files, { exclude = [] } = {}) {
  const entries = {};
  const mtime = new Date('1980-01-01T00:00:00.000Z');
  for (const file of files) {
    normalizeMemberPath(file.path);
    if (exclude.includes(file.path)) continue;
    entries[file.path] = [new Uint8Array(file.bytes), { level: 6, mtime }];
  }
  if (!entries['index.html']) {
    fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'A CMS bundle must contain index.html at its root.');
  }
  return Buffer.from(zipSync(entries, { level: 6, mtime }));
}

export function validateBundleBytes(zipBytes, bundle, label = 'CMS bundle') {
  if (!bundle || bundle.format !== 'zip' || bundle.entrypoint !== 'index.html' || !Array.isArray(bundle.files)) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' metadata is incomplete.');
  }
  let entries;
  try {
    entries = unzipSync(new Uint8Array(zipBytes));
  } catch {
    fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' is not a readable ZIP archive.');
  }
  const paths = Object.keys(entries).filter((entry) => !entry.endsWith('/')).sort();
  const expected = bundle.files.slice().sort((left, right) => left.path.localeCompare(right.path));
  if (paths.length !== expected.length) {
    fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' file set does not match its manifest.');
  }
  let total = 0;
  for (const member of expected) {
    normalizeMemberPath(member.path);
    const bytes = entries[member.path];
    if (!bytes) fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' is missing ' + member.path);
    if (!Number.isInteger(member.bytes) || member.bytes < 0) {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' member bytes are invalid.');
    }
    total += bytes.length;
    if (total > MAX_BUNDLE_BYTES) fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' exceeds the size limit.');
    if (bytes.length !== member.bytes) fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' member byte length mismatch: ' + member.path);
    if (sha256Bytes(bytes) !== member.sha256) fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' member hash mismatch: ' + member.path);
  }
  if (!entries['index.html']) fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, label + ' has no index.html.');
  return { verified: expected.length, bytes: total };
}

export function assertBundleMetadata(bundle, label = 'resource.metadata.bundle') {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' is required for an APP resource.');
  }
  if (bundle.schema !== BUNDLE_SCHEMA) fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + '.schema is unsupported.');
  if (bundle.format !== 'zip' || bundle.entrypoint !== 'index.html') {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' must describe a ZIP bundle with index.html.');
  }
  if (!Array.isArray(bundle.files) || bundle.files.length === 0 || bundle.files.length > MAX_BUNDLE_FILES) {
    fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + '.files is invalid.');
  }
  const seen = new Set();
  for (const file of bundle.files) {
    if (!file || typeof file !== 'object') fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + '.files entries must be objects.');
    normalizeMemberPath(file.path);
    if (seen.has(file.path)) fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' contains a duplicate member: ' + file.path);
    seen.add(file.path);
    if (!Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_BUNDLE_BYTES) {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' member bytes are invalid: ' + file.path);
    }
    if (typeof file.sha256 !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(file.sha256)) {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' member hash is invalid: ' + file.path);
    }
    if (file.contentType !== undefined && typeof file.contentType !== 'string') {
      fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' member contentType is invalid: ' + file.path);
    }
  }
  if (!seen.has('index.html')) fail(ERROR_CODES.PUBLICATION_HANDOFF_INVALID, label + ' must include index.html.');
  return true;
}
