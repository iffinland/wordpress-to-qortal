import { open, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { QmsError, ERROR_CODES } from '../errors.js';

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function readFileIfExists(target, encoding = 'utf8') {
  try {
    return await readFile(target, encoding);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function readJsonIfExists(target) {
  const raw = await readFileIfExists(target);
  if (raw === null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new QmsError(ERROR_CODES.STATE_JOURNAL_CORRUPT, `Invalid JSON in ${target}`, {
      cause: error,
      details: { path: target }
    });
  }
}

export async function fsyncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    // Directory fsync is not supported everywhere; durability degrades, correctness does not.
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error.code)) {
      throw error;
    }
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

export async function fsyncFile(filePath) {
  const handle = await open(filePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Write a file atomically: temp file + fsync + rename + directory fsync.
 * A crash can leave a stray .tmp file, never a partially written target.
 */
export async function atomicWriteFile(target, data, options = {}) {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, 'w', options.mode ?? 0o600);
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {
      // best effort
    }
    throw error;
  }
  await fsyncDirectory(directory);
}

export async function atomicWriteJson(target, value, options = {}) {
  await atomicWriteFile(target, `${JSON.stringify(value, null, 2)}\n`, options);
}

export async function appendAndSync(filePath, data) {
  const handle = await open(filePath, 'a');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256OfJson(value) {
  return `sha256:${sha256Hex(JSON.stringify(value))}`;
}
