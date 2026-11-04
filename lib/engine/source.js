import path from 'node:path';
import { QmsError, ERROR_CODES } from './errors.js';
import { isSourceError, SOURCE_ERROR_CODES } from '../source/errors.js';
import { assertContentDocument } from '../model/content.js';
import {
  SourceBatchWriter,
  batchIdForRun,
  batchPaths,
  readPreviousIndex
} from './source-batch.js';
import { atomicWriteJson } from './storage/atomic.js';

const DISCOVERY_REPORT_SCHEMA = 'qms-source-discovery-report@1';

function mapSourceError(error) {
  if (isSourceError(error)) {
    return new QmsError(error.code, error.message, {
      details: error.details,
      retryable: error.retryable
    });
  }
  return new QmsError(SOURCE_ERROR_CODES.INVALID_RESPONSE, error instanceof Error ? error.message : String(error), {
    cause: error,
    retryable: false
  });
}

function isCancellation(error) {
  return isSourceError(error) && error.code === SOURCE_ERROR_CODES.CANCELLED;
}

function linkSignal(context, signal) {
  if (!signal) {
    return () => {};
  }
  if (signal.aborted) {
    context.controller.abort('cancelled');
    return () => {};
  }
  const onAbort = () => context.controller.abort('cancelled');
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

function mergeSourceConfig(projectSource = {}, override = {}, adapterId) {
  return {
    ...projectSource,
    ...override,
    adapter: adapterId
  };
}

function sanitizeQuery(query = {}) {
  const safe = {};
  for (const field of ['after', 'before', 'modified_after', 'modified_before', 'order', 'orderby', 'status', 'search']) {
    if (query[field] !== undefined) {
      safe[field] = query[field];
    }
  }
  return safe;
}

function dedupeWarnings(warnings) {
  const seen = new Set();
  const output = [];
  for (const warning of warnings ?? []) {
    const key = `${warning.code}|${warning.details?.key ?? warning.details?.mediaId ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(warning);
    }
  }
  return output;
}

async function withBatchState(writer, status, summary, error = null) {
  try {
    await writer.markBatch({ status, report: { summary }, error });
  } catch {
    // Batch metadata failure must not hide the original operation outcome.
  }
}

export class SourceService {
  constructor({ registry, project, paths, clock, runs, events }) {
    this.registry = registry;
    this.getProject = typeof project === 'function' ? project : () => project;
    this.paths = paths;
    this.clock = clock;
    this.runs = runs;
    this.events = events;
  }

  adapters() {
    return this.registry.list();
  }

  capabilities(adapterId = 'wordpress') {
    return this.registry.capabilities(adapterId);
  }

  async validate({ adapterId = null, auth = null, source = {}, signal = null } = {}) {
    const project = this.getProject();
    const resolvedAdapterId = adapterId ?? project.source?.adapter ?? 'wordpress';
    const adapter = this.registry.get(resolvedAdapterId);
    const config = mergeSourceConfig(project.source, source, resolvedAdapterId);
    const context = await this.runs.start({
      kind: 'source.validate',
      phase: 'connect',
      meta: { adapterId: resolvedAdapterId, baseUrl: config.baseUrl ?? null }
    });
    const cleanup = linkSignal(context, signal);
    let session = null;
    try {
      await context.phase('connect');
      session = await adapter.createSession({
        config,
        auth: auth ?? { mode: config.authMode ?? 'none' },
        signal: context.signal
      });
      const report = await session.validate({ signal: context.signal });
      for (const warning of dedupeWarnings([...(report.warnings ?? []), ...(session.warnings?.() ?? [])])) {
        await context.warn(warning.code, warning.message, warning.details ?? {});
      }
      await context.progress({ completed: 1, total: 1, message: 'Source connection validated', code: 'SOURCE_VALIDATED' });
      const completion = await context.complete(report);
      return { runId: completion.runId, status: 'completed', report, events: completion.events };
    } catch (error) {
      if (isCancellation(error) || context.signal.aborted) {
        const cancellation = await context.cancel();
        return { runId: context.runId, status: 'cancelled', events: cancellation?.events ?? [] };
      }
      const mapped = mapSourceError(error);
      const failure = await context.fail(mapped);
      return {
        runId: context.runId,
        status: 'failed',
        error: mapped.toJSON(),
        events: failure?.events ?? []
      };
    } finally {
      cleanup();
      if (session) {
        await session.close().catch(() => {});
      }
    }
  }

  async discover({
    adapterId = null,
    auth = null,
    source = {},
    query = {},
    contentTypes = null,
    perPage = 100,
    progressEvery = 25,
    maxItems = null,
    includeTerms = true,
    includeAssets = true,
    signal = null
  } = {}) {
    const project = this.getProject();
    const resolvedAdapterId = adapterId ?? project.source?.adapter ?? 'wordpress';
    const adapter = this.registry.get(resolvedAdapterId);
    const config = mergeSourceConfig(project.source, source, resolvedAdapterId);
    const safeQuery = sanitizeQuery(query);
    const startedAt = this.clock.nowIso();
    const context = await this.runs.start({
      kind: 'source.discover',
      phase: 'connect',
      meta: { adapterId: resolvedAdapterId, baseUrl: config.baseUrl ?? null, query: safeQuery }
    });
    const cleanup = linkSignal(context, signal);
    const batchId = batchIdForRun(context.runId);
    const paths = batchPaths(this.paths, resolvedAdapterId, batchId);
    const writer = new SourceBatchWriter({
      paths,
      adapterId: resolvedAdapterId,
      batchId,
      runId: context.runId,
      clock: this.clock,
      previousEntries: new Map()
    });
    let session = null;
    let summary = null;
    let written = 0;
    try {
      const previous = await readPreviousIndex(paths);
      writer.previousEntries = previous.entries;
      if (previous.warning) {
        await context.warn('PREVIOUS_INDEX_UNREADABLE', 'The previous completed index could not be read; treating all items as new.', {
          warning: previous.warning
        });
      }
      await writer.init();
      await writer.markBatch({ status: 'running', report: { startedAt, summary: null } });

      await context.phase('connect');
      await context.checkpoint({
        step: 'connect',
        phase: 'connect',
        cursor: 0,
        total: 0,
        resumable: true,
        resume: { service: 'source', method: 'discover', params: {
          adapterId: resolvedAdapterId,
          source: config,
          query: safeQuery,
          contentTypes,
          perPage,
          maxItems,
          includeTerms,
          includeAssets
        } },
        details: { adapterId: resolvedAdapterId, batchId }
      });
      session = await adapter.createSession({
        config,
        auth: auth ?? { mode: config.authMode ?? 'none' },
        signal: context.signal
      });
      const validation = await session.validate({ signal: context.signal });
      const counts = validation.counts ?? {};
      const unsupported = validation.unsupported ?? [];
      const unsupportedWarnings = unsupported.map((entry) => ({
        code: entry.code ?? 'UNSUPPORTED_CONTENT_TYPE',
        message: entry.message ?? `Unsupported source content: ${entry.type ?? entry.feature ?? 'unknown'}`,
        details: {
          type: entry.type ?? null,
          feature: entry.feature ?? null,
          count: entry.count ?? null,
          supported: false
        }
      }));
      await context.warn('SOURCE_CAPABILITY_REPORT', 'Source capability discovery completed.', {
        adapter: resolvedAdapterId,
        counts,
        unsupported: unsupported.length
      });
      for (const warning of unsupportedWarnings) {
        await context.warn(warning.code, warning.message, warning.details);
      }

      const termLookup = new Map();
      const assetsByParent = new Map();
      let truncated = false;
      const shouldStop = () => maxItems !== null && written >= maxItems;
      const noteTruncation = async () => {
        if (!truncated) {
          truncated = true;
          await context.warn('SOURCE_ITEM_LIMIT_REACHED', 'Discovery stopped at the configured item limit; the batch is partial.', {
            maxItems,
            written
          });
        }
      };

      const emitProgress = async (phase, completed, total) => {
        await context.progress({
          phase,
          completed,
          total: Math.max(completed, Number.isInteger(total) ? total : 0),
          code: 'SOURCE_PROGRESS',
          message: `${phase}: ${completed} item(s) normalized`,
          details: { adapter: resolvedAdapterId, batchId }
        });
      };

      const writeDocument = async (document, phase, completed, total) => {
        assertContentDocument(document, { verifyHash: true, baseUrl: config.baseUrl });
        await writer.writeItem(document);
        for (const warning of document.warnings ?? []) {
          await context.warn(warning.code, warning.message, { ...warning.details, itemId: document.id });
        }
        written += 1;
        if (written % progressEvery === 0 || completed === total) {
          await emitProgress(phase, completed, total);
        }
      };

      if (includeTerms) {
        await context.phase('terms');
        const termTotal = Number.isInteger(counts.categories) && Number.isInteger(counts.tags)
          ? counts.categories + counts.tags
          : 0;
        let termCount = 0;
        outerTerms: for await (const item of session.listTerms({ perPage, signal: context.signal })) {
          context.throwIfCancelled();
          if (shouldStop()) {
            truncated = true;
            break outerTerms;
          }
          const document = session.normalizeTerm(item);
          const key = `${item.taxonomy}:${item.raw.id}`;
          termLookup.set(key, { slug: item.raw.slug ?? null, name: item.raw.name ?? null });
          termCount += 1;
          await writeDocument(document, 'terms', termCount, termTotal);
        }
        await emitProgress('terms', termCount, termTotal);
        await context.checkpoint({
          step: 'terms_done',
          phase: 'terms',
          cursor: termCount,
          total: termTotal,
          resumable: true,
          resume: { service: 'source', method: 'discover', params: {
          adapterId: resolvedAdapterId,
          source: config,
          query: safeQuery,
          contentTypes,
          perPage,
          maxItems,
          includeTerms,
          includeAssets
        } },
          details: { batchId }
        }).catch(() => {});
      }

      if (includeAssets) {
        await context.phase('assets');
        const assetTotal = Number.isInteger(counts.media) ? counts.media : 0;
        let assetCount = 0;
        outerAssets: for await (const item of session.listAssets({ perPage, signal: context.signal })) {
          context.throwIfCancelled();
          if (shouldStop()) {
            truncated = true;
            break outerAssets;
          }
          const document = session.normalizeAsset(item);
          const parent = Number(item.raw.post ?? 0);
          if (parent) {
            if (!assetsByParent.has(parent)) assetsByParent.set(parent, []);
            assetsByParent.get(parent).push(item.raw);
          }
          assetCount += 1;
          await writeDocument(document, 'assets', assetCount, assetTotal);
        }
        await emitProgress('assets', assetCount, assetTotal);
      }

      await context.phase('content');
      const contentTotal = Number.isInteger(counts.posts) && Number.isInteger(counts.pages)
        ? counts.posts + counts.pages
        : 0;
      let contentCount = 0;
      const requestedTypes = contentTypes ?? adapter.getCapabilities().contentTypes ?? [];
      outerContent: for await (const item of session.listContent({
        contentTypes: requestedTypes,
        perPage,
        query: safeQuery,
        signal: context.signal
      })) {
        context.throwIfCancelled();
        if (shouldStop()) {
          await noteTruncation();
          break outerContent;
        }
        const document = session.normalizeContent(item, {
          termLookup,
          attachments: assetsByParent.get(Number(item.raw.id)) ?? []
        });
        contentCount += 1;
        await writeDocument(document, 'content', contentCount, contentTotal);
        if (contentCount % 50 === 0) {
          await context.checkpoint({
            step: 'content_page',
            phase: 'content',
            cursor: contentCount,
            total: contentTotal,
            resumable: true,
            resume: { service: 'source', method: 'discover', params: {
          adapterId: resolvedAdapterId,
          source: config,
          query: safeQuery,
          contentTypes,
          perPage,
          maxItems,
          includeTerms,
          includeAssets
        } },
            details: { batchId, written }
          }).catch(() => {});
        }
      }
      await emitProgress('content', contentCount, contentTotal);

      await context.phase('finalize');
      const indexResult = await writer.finalizeIndex({
        site: validation.site ?? null,
        query: safeQuery,
        counts,
        unsupported,
        warnings: dedupeWarnings([...(validation.warnings ?? []), ...(session.warnings?.() ?? [])]),
        truncated
      });
      summary = indexResult.summary;
      const report = {
        schema: DISCOVERY_REPORT_SCHEMA,
        version: 1,
        adapter: resolvedAdapterId,
        adapterVersion: adapter.version,
        contract: 'qms-source-adapter@1',
        batchId,
        runId: context.runId,
        startedAt,
        completedAt: this.clock.nowIso(),
        site: validation.site ?? null,
        capabilities: validation.capabilities ?? adapter.getCapabilities(),
        counts,
        normalized: summary,
        unsupported,
        warnings: indexResult.warnings,
        query: safeQuery,
        truncated,
        batchDir: paths.batchDir
      };
      await atomicWriteJson(paths.reportFile, report);
      await writer.markBatch({ status: 'completed', report: { summary } });
      await writer.updateLatest(indexResult);
      await writer.appendSyncHistory(indexResult);
      const latest = {
        batchId,
        batchDir: paths.batchDir,
        indexFile: paths.indexFile,
        reportFile: paths.reportFile,
        latestFile: paths.latestFile,
        syncHistoryFile: paths.syncHistoryFile
      };
      const completion = await context.complete({
        ...summary,
        batchId,
        indexFile: path.relative(paths.batchDir, paths.indexFile),
        reportFile: path.relative(paths.batchDir, paths.reportFile),
        truncated,
        unsupported: unsupported.length,
        warnings: report.warnings.length
      });
      return {
        runId: context.runId,
        status: 'completed',
        batchId,
        paths: latest,
        summary,
        report,
        events: completion.events
      };
    } catch (error) {
      const cancelled = isCancellation(error) || context.signal.aborted;
      const mapped = mapSourceError(error);
      const summaryText = writer.counts;
      await withBatchState(writer, cancelled ? 'cancelled' : 'failed', summaryText, mapped.toJSON());
      if (cancelled) {
        const cancellation = await context.cancel();
        return {
          runId: context.runId,
          status: 'cancelled',
          batchId,
          batchDir: paths.batchDir,
          events: cancellation?.events ?? []
        };
      }
      const failure = await context.fail(mapped);
      return {
        runId: context.runId,
        status: 'failed',
        batchId,
        batchDir: paths.batchDir,
        error: mapped.toJSON(),
        events: failure?.events ?? []
      };
    } finally {
      cleanup();
      if (session) {
        await session.close().catch(() => {});
      }
    }
  }
}

export { DISCOVERY_REPORT_SCHEMA };
