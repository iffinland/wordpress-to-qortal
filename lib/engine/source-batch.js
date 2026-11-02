import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {
  atomicWriteFile,
  atomicWriteJson,
  readJsonIfExists
} from './storage/atomic.js';
import { sha256Text } from '../model/content.js';
import { QmsError, ERROR_CODES } from './errors.js';

export const CONTENT_INDEX_SCHEMA = 'qms-content-index@1';
export const SYNC_HISTORY_SCHEMA = 'qms-sync-history@1';
export const BATCH_SCHEMA = 'qms-source-batch@1';

const SAFE_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,159}$/i;

export function assertSafeSegment(value, label = 'segment') {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, `Unsafe ${label}: ${String(value)}`, {
      details: { label, value }
    });
  }
  return value;
}

export function batchIdForRun(runId) {
  const suffix = String(runId).replace(/^run_/, '');
  return assertSafeSegment(`bat_${suffix}`, 'batch id');
}

export function batchPaths(projectPaths, adapterId, batchId) {
  assertSafeSegment(adapterId, 'adapter id');
  assertSafeSegment(batchId, 'batch id');
  const sourceDir = path.join(projectPaths.artifactsDir, 'source', adapterId);
  const batchDir = path.join(sourceDir, 'batches', batchId);
  return {
    sourceDir,
    batchDir,
    itemsDir: path.join(batchDir, 'items'),
    indexJsonl: path.join(batchDir, 'index.jsonl'),
    indexFile: path.join(batchDir, 'index.json'),
    reportFile: path.join(batchDir, 'report.json'),
    batchFile: path.join(batchDir, 'batch.json'),
    latestFile: path.join(sourceDir, 'latest.json'),
    syncHistoryFile: path.join(sourceDir, 'sync-history.json')
  };
}

export async function readPreviousIndex(paths) {
  const latest = await readJsonIfExists(paths.latestFile);
  if (!latest || typeof latest.indexFile !== 'string') {
    return { entries: new Map(), latest: null, warning: null };
  }
  const resolved = path.resolve(paths.sourceDir, latest.indexFile);
  if (!resolved.startsWith(`${path.resolve(paths.sourceDir)}${path.sep}`)) {
    return { entries: new Map(), latest, warning: 'LATEST_INDEX_OUTSIDE_SOURCE_DIR' };
  }
  try {
    const index = await readJsonIfExists(resolved);
    if (!index || index.schema !== CONTENT_INDEX_SCHEMA || !Array.isArray(index.entries)) {
      return { entries: new Map(), latest, warning: 'LATEST_INDEX_UNREADABLE' };
    }
    const entries = new Map(index.entries.map((entry) => [entry.sourceKey, entry]));
    return { entries, latest, warning: null };
  } catch {
    return { entries: new Map(), latest, warning: 'LATEST_INDEX_UNREADABLE' };
  }
}

/**
 * Writes one discovery batch as append-only item files plus an append-only
 * index journal. A failed or cancelled batch is never referenced by latest.json,
 * so a future cleanup step can safely operate only on verified completed batches.
 */
export class SourceBatchWriter {
  constructor({ paths, adapterId, batchId, runId, clock, previousEntries = new Map() }) {
    this.paths = paths;
    this.adapterId = adapterId;
    this.batchId = batchId;
    this.runId = runId;
    this.clock = clock;
    this.previousEntries = previousEntries;
    this.counts = { items: 0, new: 0, updated: 0, unchanged: 0, warnings: 0, unsupported: 0 };
    this.contentRoot = null;
    this.bytes = 0;
  }

  async init() {
    await mkdir(this.paths.itemsDir, { recursive: true });
    const handle = await open(this.paths.indexJsonl, 'w');
    await handle.close();
  }

  async writeItem(document, extra = {}) {
    const id = assertSafeSegment(document.id, 'content id');
    const json = `${JSON.stringify(document, null, 2)}\n`;
    const file = `items/${id}.json`;
    await atomicWriteFile(path.join(this.paths.batchDir, file), json);
    const bytes = Buffer.byteLength(json, 'utf8');
    const now = this.clock.nowIso();
    const previous = this.previousEntries.get(document.source.key);
    let status = 'new';
    if (previous) {
      status = previous.contentHash === document.content_hash ? 'unchanged' : 'updated';
    }
    const entry = {
      id: document.id,
      sourceKey: document.source.key,
      sourceType: document.source.type,
      contentType: document.content_type,
      slug: document.identity?.slug ?? null,
      oldUrl: document.identity?.old_url ?? null,
      contentHash: document.content_hash,
      rawHash: document.provenance?.raw_hash ?? null,
      sourceModifiedAt: document.dates?.modified_at ?? null,
      file,
      bytes,
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: now,
      status,
      ...extra
    };
    await appendFile(this.paths.indexJsonl, `${JSON.stringify(entry)}\n`, 'utf8');
    this.counts.items += 1;
    this.counts[status] += 1;
    this.counts.warnings += document.warnings?.length ?? 0;
    this.counts.unsupported += document.unsupported?.length ?? 0;
    this.bytes += bytes;
    const rootInput = `${this.contentRoot ?? ''}\n${document.id}:${document.content_hash}`;
    this.contentRoot = `sha256:${sha256Text(rootInput)}`;
    return entry;
  }

  async finalizeIndex({ site = null, query = null, counts = null, unsupported = [], warnings = [], truncated = false } = {}) {
    const temporary = `${this.paths.indexFile}.${process.pid}.tmp`;
    const output = createWriteStream(temporary, { encoding: 'utf8' });
    const write = (chunk) => new Promise((resolve, reject) => {
      if (output.write(chunk)) {
        resolve();
      } else {
        output.once('drain', resolve);
        output.once('error', reject);
      }
    });
    try {
      await write(`{\n  "schema": "${CONTENT_INDEX_SCHEMA}",\n  "version": 1,\n  "adapter": "${this.adapterId}",\n  "batchId": "${this.batchId}",\n  "runId": "${this.runId}",\n  "generatedAt": "${this.clock.nowIso()}",\n  "entries": [\n`);
      let first = true;
      let count = 0;
      const input = await open(this.paths.indexJsonl, 'r');
      const lines = readline.createInterface({ input: input.createReadStream(), crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        await write(`${first ? '' : ',\n'}    ${JSON.stringify(entry)}`);
        first = false;
        count += 1;
      }
      await write(`\n  ],\n  "summary": ${JSON.stringify({
        items: count,
        new: this.counts.new,
        updated: this.counts.updated,
        unchanged: this.counts.unchanged,
        warnings: this.counts.warnings,
        unsupported: this.counts.unsupported,
        bytes: this.bytes,
        contentRoot: this.contentRoot,
        truncated: Boolean(truncated)
      }, null, 2).replace(/\n/g, '\n  ')}\n}\n`);
      await new Promise((resolve, reject) => {
        output.end(resolve);
        output.once('error', reject);
      });
      await rename(temporary, this.paths.indexFile);
      return {
        schema: CONTENT_INDEX_SCHEMA,
        version: 1,
        adapter: this.adapterId,
        batchId: this.batchId,
        runId: this.runId,
        indexFile: path.relative(this.paths.sourceDir, this.paths.indexFile),
        summary: {
          items: count,
          new: this.counts.new,
          updated: this.counts.updated,
          unchanged: this.counts.unchanged,
          warnings: this.counts.warnings,
          unsupported: this.counts.unsupported,
          bytes: this.bytes,
          contentRoot: this.contentRoot,
          truncated: Boolean(truncated)
        },
        site,
        query,
        counts,
        unsupported,
        warnings
      };
    } catch (error) {
      output.destroy();
      throw error;
    }
  }

  async markBatch({ status, report, error = null }) {
    const document = {
      schema: BATCH_SCHEMA,
      version: 1,
      adapter: this.adapterId,
      batchId: this.batchId,
      runId: this.runId,
      status,
      createdAt: report?.startedAt ?? this.clock.nowIso(),
      completedAt: status === 'running' ? null : this.clock.nowIso(),
      counts: report?.summary ?? null,
      error
    };
    await atomicWriteJson(this.paths.batchFile, document);
    return document;
  }

  async updateLatest(indexResult) {
    await atomicWriteJson(this.paths.latestFile, {
      schema: 'qms-source-latest@1',
      version: 1,
      adapter: this.adapterId,
      batchId: this.batchId,
      runId: this.runId,
      status: 'completed',
      indexFile: indexResult.indexFile,
      reportFile: path.relative(this.paths.sourceDir, this.paths.reportFile),
      counts: indexResult.summary,
      updatedAt: this.clock.nowIso()
    });
  }

  async appendSyncHistory(indexResult) {
    const existing = await readJsonIfExists(this.paths.syncHistoryFile);
    const entries = existing?.schema === SYNC_HISTORY_SCHEMA && Array.isArray(existing.entries)
      ? existing.entries
      : [];
    entries.push({
      batchId: this.batchId,
      runId: this.runId,
      adapter: this.adapterId,
      status: 'completed',
      completedAt: this.clock.nowIso(),
      counts: indexResult.summary,
      indexFile: indexResult.indexFile
    });
    await atomicWriteJson(this.paths.syncHistoryFile, {
      schema: SYNC_HISTORY_SCHEMA,
      version: 1,
      adapter: this.adapterId,
      entries
    });
  }

  async reportSize() {
    try {
      const stats = await stat(this.paths.indexFile);
      return stats.size;
    } catch {
      return null;
    }
  }
}
