import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { QmsError, ERROR_CODES } from '../engine/errors.js';
import { assertPathInside } from '../engine/storage/paths.js';
import { fsyncDirectory } from '../engine/storage/atomic.js';

export function normalizeHash(hash) {
  const value = String(hash ?? '');
  if (/^sha256:[a-f0-9]{64}$/.test(value)) return value;
  if (/^[a-f0-9]{64}$/.test(value)) return 'sha256:' + value;
  throw new QmsError(ERROR_CODES.MEDIA_HASH_MISMATCH, 'Invalid SHA-256 media hash.', { details: { hash } });
}

export function hashHex(hash) {
  return normalizeHash(hash).slice('sha256:'.length);
}

export function assetPathFor(assetsDir, hash) {
  const hex = hashHex(hash);
  const candidate = path.join(assetsDir, hex.slice(0, 2), hex);
  return assertPathInside(assetsDir, candidate, 'media asset path');
}

export function partPathFor(tmpDir, url) {
  const digest = createHash('sha256').update(String(url), 'utf8').digest('hex');
  return assertPathInside(tmpDir, path.join(tmpDir, digest + '.part'), 'media part path');
}

export async function hashFile(filePath) {
  const hash = createHash('sha256');
  let bytes = 0;
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return { hash: 'sha256:' + hash.digest('hex'), bytes };
}

export async function inspectPath(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function assertRegularFile(filePath, label = 'media file') {
  const info = await inspectPath(filePath);
  if (!info) return null;
  if (info.isSymbolicLink()) {
    throw new QmsError(ERROR_CODES.MEDIA_UNSAFE_PATH, 'Refusing to use a symbolic link as ' + label + '.', {
      details: { filePath }
    });
  }
  if (!info.isFile()) {
    throw new QmsError(ERROR_CODES.MEDIA_UNSAFE_PATH, 'Refusing to use a non-regular file as ' + label + '.', {
      details: { filePath }
    });
  }
  return info;
}

export async function verifyAsset({ filePath, hash, bytes = null }) {
  const info = await assertRegularFile(filePath, 'a stored media asset');
  if (!info) return { valid: false, missing: true };
  if (bytes !== null && bytes !== undefined && info.size !== bytes) {
    return { valid: false, reason: 'size', expectedBytes: bytes, actualBytes: info.size };
  }
  const computed = await hashFile(filePath);
  if (computed.hash !== normalizeHash(hash)) {
    return { valid: false, reason: 'hash', expectedHash: hash, actualHash: computed.hash };
  }
  return { valid: true, bytes: computed.bytes, hash: computed.hash };
}

/**
 * Finalize a fully written .part file.
 *
 * - the hash is always recomputed from disk;
 * - a mismatching or unexpected file is never renamed into place;
 * - the final path is content-addressed and derived only from the hash;
 * - an existing valid asset is reused (dedupe), an existing corrupt asset is
 *   reported instead of overwritten.
 */
export async function finalizePart({ partPath, assetsDir, expectedHash = null, expectedBytes = null }) {
  const info = await assertRegularFile(partPath, 'a download part file');
  if (!info) {
    throw new QmsError(ERROR_CODES.MEDIA_PART_CORRUPT, 'Download part file is missing.', { details: { partPath } });
  }
  if (expectedBytes !== null && expectedBytes !== undefined && info.size !== expectedBytes) {
    throw new QmsError(ERROR_CODES.MEDIA_SIZE_MISMATCH, 'Downloaded byte count does not match the expected size.', {
      details: { partPath, expectedBytes, actualBytes: info.size }
    });
  }
  const computed = await hashFile(partPath);
  if (expectedHash && computed.hash !== normalizeHash(expectedHash)) {
    throw new QmsError(ERROR_CODES.MEDIA_HASH_MISMATCH, 'Downloaded content hash does not match the expected hash.', {
      details: { partPath, expectedHash, actualHash: computed.hash }
    });
  }
  const finalPath = assetPathFor(assetsDir, computed.hash);
  await mkdir(path.dirname(finalPath), { recursive: true });

  const existing = await inspectPath(finalPath);
  if (existing) {
    const verified = await verifyAsset({ filePath: finalPath, hash: computed.hash, bytes: computed.bytes });
    if (!verified.valid) {
      throw new QmsError(ERROR_CODES.MEDIA_HASH_MISMATCH, 'An existing content-addressed asset is corrupt; refusing to overwrite it silently.', {
        details: { finalPath, verification: verified }
      });
    }
    await unlink(partPath).catch(() => {});
    return { hash: computed.hash, bytes: computed.bytes, filePath: finalPath, reused: true };
  }

  const handle = await open(partPath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(partPath, finalPath);
  await fsyncDirectory(path.dirname(finalPath));
  return { hash: computed.hash, bytes: computed.bytes, filePath: finalPath, reused: false };
}

export async function fileSize(filePath) {
  try {
    const info = await stat(filePath);
    return info.size;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function relativeAssetPath(assetsDir, filePath) {
  return path.relative(assetsDir, filePath).split(path.sep).join('/');
}
