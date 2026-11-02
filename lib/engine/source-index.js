import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { QmsError, ERROR_CODES } from './errors.js';
import { readJsonIfExists } from './storage/atomic.js';
import { assertPathInside } from './storage/paths.js';
import { assertSafeSegment } from './source-batch.js';
import { assertContentDocument } from '../model/content.js';

export const CONTENT_SCHEMA_NAME = 'qms-content@1';

function sourceDirFor(paths, adapterId) {
  assertSafeSegment(adapterId, 'adapter id');
  return path.join(paths.artifactsDir, 'source', adapterId);
}

/**
 * Resolve the latest verified Phase 2 discovery batch. An incomplete or
 * cancelled batch is never used as planning input.
 */
export async function resolveLatestSourceBatch(paths, adapterId) {
  const sourceDir = sourceDirFor(paths, adapterId);
  const latestFile = path.join(sourceDir, 'latest.json');
  const latest = await readJsonIfExists(latestFile);
  if (!latest) {
    throw new QmsError(
      ERROR_CODES.SOURCE_DISCOVERY_REQUIRED,
      'No completed source discovery batch exists for this project.',
      { details: { adapter: adapterId, latestFile } }
    );
  }
  if (latest.status !== 'completed' || latest.schema !== 'qms-source-latest@1') {
    throw new QmsError(ERROR_CODES.SOURCE_INDEX_UNREADABLE, 'The latest source pointer is not a completed batch.', {
      details: { latestFile, status: latest.status, schema: latest.schema }
    });
  }
  const batchId = assertSafeSegment(latest.batchId, 'batch id');
  const batchDir = assertPathInside(sourceDir, path.join(sourceDir, 'batches', batchId), 'source batch directory');
  const batchFile = path.join(batchDir, 'batch.json');
  const batch = await readJsonIfExists(batchFile);
  if (!batch || batch.schema !== 'qms-source-batch@1' || batch.status !== 'completed') {
    throw new QmsError(ERROR_CODES.SOURCE_INDEX_UNREADABLE, 'The latest source batch is not marked completed.', {
      details: { batchFile, status: batch?.status ?? null }
    });
  }
  const indexJsonl = path.join(batchDir, 'index.jsonl');
  const indexFile = path.join(batchDir, 'index.json');
  const reportFile = path.join(batchDir, 'report.json');
  const report = await readJsonIfExists(reportFile);
  try {
    const info = await stat(indexJsonl);
    if (!info.isFile() || info.size === 0) throw new Error('empty index journal');
  } catch (error) {
    throw new QmsError(ERROR_CODES.SOURCE_INDEX_UNREADABLE, 'The latest source batch has no append-only index journal.', {
      cause: error,
      details: { batchDir, indexJsonl }
    });
  }
  return {
    adapterId,
    sourceDir,
    latestFile,
    latest,
    batchId,
    batchDir,
    batchFile,
    indexJsonl,
    indexFile,
    reportFile,
    report,
    site: report?.site ?? latest.site ?? null,
    truncated: report?.truncated === true || latest.counts?.truncated === true,
    counts: latest.counts ?? report?.normalized ?? null
  };
}

/** Stream index metadata; item bodies are not loaded here. */
export async function readIndexEntries(indexJsonl, { maxEntries = 50_000 } = {}) {
  const entries = [];
  let truncated = false;
  const input = createReadStream(indexJsonl, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (entries.length >= maxEntries) {
        truncated = true;
        break;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (error) {
        throw new QmsError(ERROR_CODES.SOURCE_INDEX_UNREADABLE, 'Source index contains an unreadable entry.', {
          cause: error,
          details: { indexJsonl, lineNumber: entries.length + 1 }
        });
      }
      if (
        !entry ||
        typeof entry.sourceKey !== 'string' ||
        typeof entry.contentType !== 'string' ||
        typeof entry.contentHash !== 'string' ||
        typeof entry.file !== 'string'
      ) {
        throw new QmsError(ERROR_CODES.SOURCE_INDEX_UNREADABLE, 'Source index entry is missing required fields.', {
          details: { indexJsonl, entry }
        });
      }
      entries.push(entry);
    }
  } finally {
    input.destroy();
  }
  return { entries, truncated };
}

export async function readIndexedItem(batchDir, entry, { baseUrl = null } = {}) {
  const relative = String(entry.file).replace(/\\/g, '/');
  if (relative.startsWith('/') || relative.split('/').includes('..')) {
    throw new QmsError(ERROR_CODES.SOURCE_INDEX_UNREADABLE, 'Source index entry path is unsafe.', {
      details: { file: entry.file }
    });
  }
  const filePath = assertPathInside(batchDir, path.join(batchDir, relative), 'source item path');
  let document;
  try {
    document = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new QmsError(ERROR_CODES.SOURCE_INDEX_UNREADABLE, 'Could not read a source item referenced by the index.', {
      cause: error,
      details: { filePath, sourceKey: entry.sourceKey }
    });
  }
  if (document.schema !== CONTENT_SCHEMA_NAME) {
    throw new QmsError(ERROR_CODES.SOURCE_INDEX_UNREADABLE, 'Source item is not a qms-content@1 document.', {
      details: { filePath, schema: document.schema }
    });
  }
  assertContentDocument(document, { verifyHash: true, baseUrl });
  if (document.source?.key !== entry.sourceKey || document.id !== entry.id) {
    throw new QmsError(ERROR_CODES.PLAN_STALE, 'Source item identity no longer matches the index entry.', {
      details: {
        sourceKey: entry.sourceKey,
        documentKey: document.source?.key ?? null,
        id: entry.id,
        documentId: document.id ?? null
      }
    });
  }
  if (document.content_hash !== entry.contentHash) {
    throw new QmsError(ERROR_CODES.PLAN_STALE, 'Source item content hash no longer matches its index entry.', {
      details: { sourceKey: entry.sourceKey, indexHash: entry.contentHash, itemHash: document.content_hash }
    });
  }
  return document;
}
