import path from 'node:path';
import { appendFile, readFile } from 'node:fs/promises';
import { QmsError, ERROR_CODES } from './errors.js';
import { isSourceError, SOURCE_ERROR_CODES } from '../source/errors.js';
import { assertContentDocument } from '../model/content.js';
import {
  SourceBatchWriter,
  batchIdForRun,
  batchPaths,
  readPreviousIndex,
  assertSafeSegment
} from './source-batch.js';
import { atomicWriteJson } from './storage/atomic.js';

const DISCOVERY_REPORT_SCHEMA = 'qms-source-discovery-report@1';
const QUICK_STATE_SCHEMA = 'qms-quick-scan-state@1';
const QUICK_CONTENT_SCHEMA = 'qms-quick-scan-content@1';
const FULL_STATE_SCHEMA = 'qms-full-scan-state@1';
const CONTENT_FIELDS = 'id,date,date_gmt,modified,modified_gmt,slug,status,type,link,title,content,excerpt,author,featured_media,categories,tags,format,sticky,template,parent,menu_order,guid';
const TERM_FIELDS = 'id,count,description,link,name,slug,taxonomy,parent';
const MEDIA_FIELDS = 'id,date,date_gmt,modified,modified_gmt,slug,status,type,link,title,author,media_type,mime_type,source_url,alt_text,caption,description,post,media_details';
const MAX_QUICK_PAGE_SIZE = 100;
const MAX_QUICK_PAGES = 20;
const QUICK_TERM_PAGE_SIZE = 100;
const QUICK_MEDIA_PAGE_SIZE = 100;
const FULL_STATE_FILE = 'full-scan-state.json';
const QUICK_STATE_FILE = 'quick-scan-state.json';
const QUICK_CONTENT_FILE = 'quick-content.json';
const ATTACHMENT_CACHE_FILE = 'attachments-by-parent.jsonl';

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
  for (const field of [
    'after', 'before', 'modified_after', 'modified_before', 'order', 'orderby', 'status', 'search',
    'include', 'slug', 'categories', 'tags', 'parent', 'author'
  ]) {
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

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function stringList(value, { numeric = false, max = 5000 } = {}) {
  const input = Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
  const output = [];
  const seen = new Set();
  for (const raw of input) {
    for (const part of String(raw).split(',')) {
      const text = part.trim();
      if (!text) continue;
      if (numeric && !/^\d+$/.test(text)) continue;
      if (!numeric && !/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(text)) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      output.push(numeric ? Number(text) : text);
      if (output.length >= max) return output;
    }
  }
  return output;
}

function normalizeSelection(selection = {}, { perPage, maxItems, contentTypes }) {
  const include = stringList(selection.include ?? selection.postIds ?? selection.ids, { numeric: true });
  const slug = stringList(selection.slug ?? selection.slugs);
  const pageSize = clamp(selection.perPage ?? perPage ?? MAX_QUICK_PAGE_SIZE, 1, MAX_QUICK_PAGE_SIZE);
  const maxPages = clamp(selection.maxPages ?? 1, 1, MAX_QUICK_PAGES);
  const requestedLimit = selection.maxItems ?? maxItems ?? pageSize * maxPages;
  const effectiveLimit = clamp(requestedLimit, 1, Math.min(2000, pageSize * maxPages));
  return {
    include,
    slug,
    perPage: pageSize,
    maxPages,
    maxItems: effectiveLimit,
    contentTypes: [...new Set(contentTypes ?? ['post'])],
    worstCasePages: maxPages * Math.max(1, [...new Set(contentTypes ?? ['post'])].length)
  };
}

function selectionQuery(selection) {
  const query = {};
  if (selection.include.length > 0) query.include = selection.include;
  if (selection.slug.length > 0) query.slug = selection.slug;
  return query;
}

function compactMedia(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id,
    post: raw.post ?? 0,
    slug: raw.slug ?? null,
    status: raw.status ?? null,
    media_type: raw.media_type ?? null,
    mime_type: raw.mime_type ?? null,
    source_url: raw.source_url ?? null,
    alt_text: raw.alt_text ?? null,
    title: raw.title ?? null,
    caption: raw.caption ?? null,
    description: raw.description ?? null,
    media_details: raw.media_details ?? null,
    date: raw.date ?? null,
    date_gmt: raw.date_gmt ?? null,
    modified: raw.modified ?? null,
    modified_gmt: raw.modified_gmt ?? null,
    type: raw.type ?? 'attachment',
    link: raw.link ?? null
  };
}

function countContentTypes(items) {
  const counts = { posts: 0, pages: 0 };
  for (const item of items) {
    if (item.contentType === 'page') counts.pages += 1;
    else counts.posts += 1;
  }
  return counts;
}

async function readState(file, schema) {
  try {
    const text = await readFile(file, 'utf8');
    const document = JSON.parse(text);
    return document?.schema === schema ? document : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

async function readAttachmentCache(file) {
  const map = new Map();
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return map;
    throw error;
  }
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const raw = entry?.raw;
    if (!raw || !Number.isInteger(Number(raw.id))) continue;
    if (seen.has(Number(raw.id))) continue;
    seen.add(Number(raw.id));
    const parent = Number(raw.post ?? entry.post ?? 0);
    if (!Number.isInteger(parent) || parent <= 0) continue;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent).push(raw);
  }
  return map;
}

async function appendAttachmentCache(file, entries) {
  if (entries.length === 0) return;
  const lines = entries.map((entry) => JSON.stringify({ post: entry.post, raw: compactMedia(entry.raw) })).join('\n');
  await appendFile(file, lines + '\n', 'utf8');
}

function quickBoundTotal(availableByType, selection) {
  let total = 0;
  let known = false;
  for (const contentType of selection.contentTypes) {
    const value = Number(availableByType[contentType]);
    if (Number.isInteger(value) && value >= 0) {
      known = true;
      total += Math.min(value, selection.perPage * selection.maxPages);
    }
  }
  return known ? Math.min(total, selection.maxItems) : 0;
}

function checkpointResumeParams({ adapterId, config, safeQuery, contentTypes, perPage, maxItems, includeTerms, includeAssets, mode, selection, batchId, stage }) {
  return {
    service: 'source',
    method: 'discover',
    params: {
      adapterId,
      source: config,
      query: safeQuery,
      contentTypes,
      perPage,
      maxItems,
      includeTerms,
      includeAssets,
      mode,
      selection,
      resume: { batchId, stage }
    }
  };
}

async function withBatchState(writer, status, summary, error = null) {
  try {
    await writer.markBatch({ status, report: { summary }, error });
  } catch {
    // Batch metadata failure must not hide the original operation outcome.
  }
}

async function emitProgress(context, { phase, completed, total, bytes = 0, message, details = {} }) {
  const safeTotal = Number.isInteger(total) && total >= 0 ? total : 0;
  const safeCompleted = safeTotal > 0 ? Math.min(completed, safeTotal) : 0;
  await context.progress({
    phase,
    completed: safeCompleted,
    total: safeTotal,
    bytes,
    code: 'SOURCE_PROGRESS',
    message,
    details
  });
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

  async discover(options = {}) {
    const mode = options.mode === 'quick' ? 'quick' : 'full';
    if (mode === 'quick') {
      return this._discoverQuick(options);
    }
    return this._discoverFull(options);
  }

  /**
   * Quick scan: one bounded content window plus only the taxonomy terms and
   * media-library records those items reference. It never enumerates the site.
   */
  async _discoverQuick({
    adapterId = null,
    auth = null,
    source = {},
    query = {},
    contentTypes = null,
    perPage = MAX_QUICK_PAGE_SIZE,
    progressEvery = 25,
    maxItems = null,
    includeTerms = true,
    includeAssets = true,
    selection = {},
    resume = null,
    resumeFrom = null,
    signal = null
  } = {}) {
    const project = this.getProject();
    const resolvedAdapterId = adapterId ?? project.source?.adapter ?? 'wordpress';
    const adapter = this.registry.get(resolvedAdapterId);
    const config = mergeSourceConfig(project.source, source, resolvedAdapterId);
    const safeQuery = sanitizeQuery(query);
    const requestedTypes = contentTypes ?? adapter.getCapabilities().contentTypes ?? ['post'];
    const normalizedSelection = normalizeSelection(selection, { perPage, maxItems, contentTypes: requestedTypes });
    const types = normalizedSelection.contentTypes;
    const resumeInfo = this._resumeInfo(resume, resumeFrom);
    const startedAt = this.clock.nowIso();
    const context = await this.runs.start({
      kind: 'source.discover',
      phase: 'connect',
      meta: {
        adapterId: resolvedAdapterId,
        baseUrl: config.baseUrl ?? null,
        query: safeQuery,
        mode: 'quick',
        selection: {
          include: normalizedSelection.include.length,
          slug: normalizedSelection.slug.length,
          perPage: normalizedSelection.perPage,
          maxPages: normalizedSelection.maxPages,
          maxItems: normalizedSelection.maxItems,
          contentTypes: types,
          worstCasePages: normalizedSelection.worstCasePages
        }
      }
    });
    const cleanup = linkSignal(context, signal);
    const batchId = resumeInfo.batchId ?? batchIdForRun(context.runId);
    const paths = batchPaths(this.paths, resolvedAdapterId, batchId);
    const writer = new SourceBatchWriter({
      paths,
      adapterId: resolvedAdapterId,
      batchId,
      runId: context.runId,
      clock: this.clock,
      previousEntries: new Map(),
      resume: Boolean(resumeInfo.batchId)
    });
    let session = null;
    let summary = null;
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
        resume: checkpointResumeParams({
          adapterId: resolvedAdapterId,
          config,
          safeQuery,
          contentTypes: types,
          perPage: normalizedSelection.perPage,
          maxItems: normalizedSelection.maxItems,
          includeTerms,
          includeAssets,
          mode: 'quick',
          selection: normalizedSelection,
          batchId,
          stage: 'connect'
        }),
        details: { adapterId: resolvedAdapterId, batchId, mode: 'quick' }
      });

      session = await adapter.createSession({
        config,
        auth: auth ?? { mode: config.authMode ?? 'none' },
        signal: context.signal
      });
      // Bounded validation: site contract + capabilities only. No site-wide
      // counts, no media enumeration and no custom-type count queries.
      const validation = await session.validate({ signal: context.signal, bounded: true });
      for (const warning of dedupeWarnings([...(validation.warnings ?? []), ...(session.warnings?.() ?? [])])) {
        await context.warn(warning.code, warning.message, warning.details ?? {});
      }
      const unsupported = validation.unsupported ?? [];
      await context.warn('SOURCE_CAPABILITY_REPORT', 'Bounded source capability discovery completed.', {
        adapter: resolvedAdapterId,
        mode: 'quick',
        counts: {},
        unsupported: unsupported.length
      });

      const stateFile = path.join(paths.batchDir, QUICK_STATE_FILE);
      const contentFile = path.join(paths.batchDir, QUICK_CONTENT_FILE);
      let state = resumeInfo.batchId
        ? await readState(stateFile, QUICK_STATE_SCHEMA)
        : null;
      if (!state) {
        state = {
          schema: QUICK_STATE_SCHEMA,
          version: 1,
          batchId,
          mode: 'quick',
          selection: normalizedSelection,
          contentStageComplete: false,
          pagesByType: {},
          availableByType: {},
          termLookup: {},
          termIds: { category: [], tag: [] },
          termsDone: false,
          media: {},
          mediaDone: false,
          contentProcessed: 0,
          updatedAt: null
        };
      }
      if (state.batchId !== batchId) {
        throw new QmsError(ERROR_CODES.RECOVERY_NOT_RESUMABLE, 'The quick-scan checkpoint belongs to a different batch.', {
          details: { checkpointBatchId: state.batchId ?? null, batchId }
        });
      }
      let contentCache = resumeInfo.batchId
        ? await readState(contentFile, QUICK_CONTENT_SCHEMA)
        : null;
      if (!contentCache) {
        contentCache = {
          schema: QUICK_CONTENT_SCHEMA,
          version: 1,
          batchId,
          items: [],
          pagesByType: {},
          availableByType: {},
          complete: false
        };
      }
      if (contentCache.batchId !== batchId) {
        throw new QmsError(ERROR_CODES.RECOVERY_NOT_RESUMABLE, 'The quick-scan content cache belongs to a different batch.', {
          details: { checkpointBatchId: contentCache.batchId ?? null, batchId }
        });
      }

      const persistQuickState = async () => {
        state.updatedAt = this.clock.nowIso();
        await atomicWriteJson(stateFile, state);
      };
      const persistContentCache = async () => {
        await atomicWriteJson(contentFile, contentCache);
      };

      const selectionBytes = () => session.client?.bytesTransferred ?? 0;

      if (!contentCache.complete) {
        await context.phase('select');
        let pagesFetched = Object.values(state.pagesByType).reduce((sum, value) => sum + (Number(value) || 0), 0);
        const startPages = Object.fromEntries(Object.entries(state.pagesByType).map(([type, value]) => [type, (Number(value) || 0) + 1]));
        const maxPagesDone = Math.max(0, ...types.map((type) => Number(state.pagesByType[type]) || 0));
        const remainingPages = Math.max(0, normalizedSelection.maxPages - maxPagesDone);
        for await (const page of contentPages(session, {
          contentTypes: types,
          perPage: normalizedSelection.perPage,
          page: 1,
          startPages,
          maxPages: remainingPages || 1,
          query: { ...safeQuery, ...selectionQuery(normalizedSelection) },
          fields: CONTENT_FIELDS,
          fetchFeatured: false,
          signal: context.signal
        })) {
          context.throwIfCancelled();
          const remaining = normalizedSelection.maxItems - contentCache.items.length;
          if (remaining <= 0) break;
          const accepted = page.items.slice(0, remaining);
          contentCache.items.push(...accepted);
          state.pagesByType[page.contentType] = (Number(state.pagesByType[page.contentType]) || 0) + 1;
          state.availableByType[page.contentType] = page.meta.total ?? state.availableByType[page.contentType] ?? null;
          contentCache.pagesByType = state.pagesByType;
          contentCache.availableByType = state.availableByType;
          pagesFetched += 1;
          await persistContentCache();
          await persistQuickState();
          const bound = quickBoundTotal(state.availableByType, normalizedSelection);
          await context.checkpoint({
            step: 'content_page',
            phase: 'select',
            cursor: contentCache.items.length,
            total: bound,
            resumable: true,
            resume: checkpointResumeParams({
              adapterId: resolvedAdapterId,
              config,
              safeQuery,
              contentTypes: types,
              perPage: normalizedSelection.perPage,
              maxItems: normalizedSelection.maxItems,
              includeTerms,
              includeAssets,
              mode: 'quick',
              selection: normalizedSelection,
              batchId,
              stage: 'content_page'
            }),
            details: {
              batchId,
              mode: 'quick',
              pagesByType: state.pagesByType,
              availableByType: state.availableByType,
              itemsFetched: contentCache.items.length
            }
          });
          await emitProgress(context, {
            phase: 'select',
            completed: contentCache.items.length,
            total: bound,
            bytes: selectionBytes(),
            message: `Quick scan: ${contentCache.items.length} content item(s) selected from ${pagesFetched} API page(s)`,
            details: {
              mode: 'quick',
              pagesFetched,
              pagesByType: state.pagesByType,
              totalAvailable: state.availableByType,
              requested: normalizedSelection.maxItems,
              requests: session.client?.requestCount ?? 0,
              bytesTransferred: selectionBytes()
            }
          });
          if (contentCache.items.length >= normalizedSelection.maxItems) break;
        }
        contentCache.complete = true;
        state.contentStageComplete = true;
        await persistContentCache();
        await persistQuickState();
        await context.checkpoint({
          step: 'content_fetched',
          phase: 'select',
          cursor: contentCache.items.length,
          total: contentCache.items.length,
          resumable: true,
          resume: checkpointResumeParams({
            adapterId: resolvedAdapterId,
            config,
            safeQuery,
            contentTypes: types,
            perPage: normalizedSelection.perPage,
            maxItems: normalizedSelection.maxItems,
            includeTerms,
            includeAssets,
            mode: 'quick',
            selection: normalizedSelection,
            batchId,
            stage: 'content_fetched'
          }),
          details: {
            batchId,
            mode: 'quick',
            pagesByType: state.pagesByType,
            availableByType: state.availableByType,
            itemsFetched: contentCache.items.length
          }
        });
      }

      const termLookup = new Map(Object.entries(state.termLookup ?? {}));
      const termIds = { category: new Set(), tag: new Set() };
      for (const item of contentCache.items) {
        for (const id of item.raw.categories ?? []) termIds.category.add(Number(id));
        for (const id of item.raw.tags ?? []) termIds.tag.add(Number(id));
      }
      state.termIds = {
        category: [...termIds.category].filter((id) => Number.isInteger(id) && id > 0),
        tag: [...termIds.tag].filter((id) => Number.isInteger(id) && id > 0)
      };

      if (includeTerms && !state.termsDone) {
        await context.phase('terms');
        const requestedTerms = state.termIds.category.length + state.termIds.tag.length;
        let termCount = termLookup.size;
        for (const taxonomy of ['category', 'tag']) {
          const pending = state.termIds[taxonomy].filter((id) => !termLookup.has(`${taxonomy}:${id}`));
          if (pending.length === 0) continue;
          for (const chunk of chunkArray(pending, QUICK_TERM_PAGE_SIZE)) {
            for await (const page of termPages(session, {
              taxonomies: [taxonomy],
              perPage: QUICK_TERM_PAGE_SIZE,
              includeByTaxonomy: { [taxonomy]: chunk },
              fields: TERM_FIELDS,
              signal: context.signal
            })) {
              context.throwIfCancelled();
              for (const item of page.items) {
                const key = `${taxonomy}:${item.raw.id}`;
                termLookup.set(key, { slug: item.raw.slug ?? null, name: item.raw.name ?? null });
                const document = session.normalizeTerm(item);
                await writer.writeItem(document);
                termCount += 1;
              }
              state.termLookup = Object.fromEntries(termLookup.entries());
              await persistQuickState();
              await context.checkpoint({
                step: 'terms_page',
                phase: 'terms',
                cursor: termCount,
                total: requestedTerms,
                resumable: true,
                resume: checkpointResumeParams({
                  adapterId: resolvedAdapterId,
                  config,
                  safeQuery,
                  contentTypes: types,
                  perPage: normalizedSelection.perPage,
                  maxItems: normalizedSelection.maxItems,
                  includeTerms,
                  includeAssets,
                  mode: 'quick',
                  selection: normalizedSelection,
                  batchId,
                  stage: 'terms_page'
                }),
                details: { batchId, mode: 'quick', termsReferenced: termCount, termsRequested: requestedTerms }
              });
              await emitProgress(context, {
                phase: 'terms',
                completed: termCount,
                total: requestedTerms,
                bytes: selectionBytes(),
                message: `Quick scan: ${termCount} referenced taxonomy term(s) fetched`,
                details: {
                  mode: 'quick',
                  termsReferenced: termCount,
                  termsRequested: requestedTerms,
                  requests: session.client?.requestCount ?? 0,
                  bytesTransferred: selectionBytes()
                }
              });
            }
          }
        }
        state.termLookup = Object.fromEntries(termLookup.entries());
        state.termsDone = true;
        await persistQuickState();
        await context.checkpoint({
          step: 'terms_done',
          phase: 'terms',
          cursor: termCount,
          total: requestedTerms,
          resumable: true,
          resume: checkpointResumeParams({
            adapterId: resolvedAdapterId,
            config,
            safeQuery,
            contentTypes: types,
            perPage: normalizedSelection.perPage,
            maxItems: normalizedSelection.maxItems,
            includeTerms,
            includeAssets,
            mode: 'quick',
            selection: normalizedSelection,
            batchId,
            stage: 'terms_done'
          }),
          details: { batchId, mode: 'quick', termsReferenced: termCount, termsRequested: requestedTerms }
        });
      }

      const mediaById = new Map(Object.entries(state.media ?? {}).map(([id, raw]) => [Number(id), raw]));
      if (includeAssets && !state.mediaDone) {
        await context.phase('assets');
        const referenced = new Set();
        for (const item of contentCache.items) {
          if (typeof session.referencedMediaIds === 'function') {
            for (const id of session.referencedMediaIds(item.raw)) referenced.add(id);
          } else {
            const featured = Number(item.raw.featured_media);
            if (Number.isInteger(featured) && featured > 0) referenced.add(featured);
          }
        }
        const pending = [...referenced].filter((id) => !mediaById.has(id));
        let mediaCount = mediaById.size;
        for (const chunk of chunkArray(pending, QUICK_MEDIA_PAGE_SIZE)) {
          for await (const page of assetPages(session, {
            include: chunk,
            perPage: QUICK_MEDIA_PAGE_SIZE,
            fields: MEDIA_FIELDS,
            signal: context.signal
          })) {
            context.throwIfCancelled();
            for (const item of page.items) {
              const id = Number(item.raw.id);
              mediaById.set(id, compactMedia(item.raw));
              const document = session.normalizeAsset(item);
              await writer.writeItem(document);
              mediaCount += 1;
            }
            state.media = Object.fromEntries(mediaById.entries());
            await persistQuickState();
            await context.checkpoint({
              step: 'media_page',
              phase: 'assets',
              cursor: mediaCount,
              total: referenced.size,
              resumable: true,
              resume: checkpointResumeParams({
                adapterId: resolvedAdapterId,
                config,
                safeQuery,
                contentTypes: types,
                perPage: normalizedSelection.perPage,
                maxItems: normalizedSelection.maxItems,
                includeTerms,
                includeAssets,
                mode: 'quick',
                selection: normalizedSelection,
                batchId,
                stage: 'media_page'
              }),
              details: { batchId, mode: 'quick', mediaDependencies: mediaCount, mediaRequested: referenced.size }
            });
            await emitProgress(context, {
              phase: 'assets',
              completed: mediaCount,
              total: referenced.size,
              bytes: selectionBytes(),
              message: `Quick scan: ${mediaCount} media dependency record(s) fetched`,
              details: {
                mode: 'quick',
                mediaDependencies: mediaCount,
                mediaRequested: referenced.size,
                requests: session.client?.requestCount ?? 0,
                bytesTransferred: selectionBytes()
              }
            });
          }
        }
        state.media = Object.fromEntries(mediaById.entries());
        state.mediaDone = true;
        await persistQuickState();
        await context.checkpoint({
          step: 'media_done',
          phase: 'assets',
          cursor: mediaCount,
          total: referenced.size,
          resumable: true,
          resume: checkpointResumeParams({
            adapterId: resolvedAdapterId,
            config,
            safeQuery,
            contentTypes: types,
            perPage: normalizedSelection.perPage,
            maxItems: normalizedSelection.maxItems,
            includeTerms,
            includeAssets,
            mode: 'quick',
            selection: normalizedSelection,
            batchId,
            stage: 'media_done'
          }),
          details: { batchId, mode: 'quick', mediaDependencies: mediaCount, mediaRequested: referenced.size }
        });
      }

      const attachmentsByParent = new Map();
      for (const raw of mediaById.values()) {
        const parent = Number(raw.post ?? 0);
        if (!Number.isInteger(parent) || parent <= 0) continue;
        if (!attachmentsByParent.has(parent)) attachmentsByParent.set(parent, []);
        attachmentsByParent.get(parent).push(raw);
      }

      await context.phase('content');
      let contentProcessed = Number(state.contentProcessed) || 0;
      const typeCounts = countContentTypes(contentCache.items);
      for (let index = contentProcessed; index < contentCache.items.length; index += 1) {
        context.throwIfCancelled();
        const item = contentCache.items[index];
        const raw = item.raw;
        const featured = mediaById.get(Number(raw.featured_media)) ?? null;
        const attachments = attachmentsByParent.get(Number(raw.id)) ?? [];
        const document = session.normalizeContent({
          contentType: item.contentType,
          raw,
          featuredMedia: featured
        }, {
          termLookup,
          attachments
        });
        assertContentDocument(document, { verifyHash: true, baseUrl: config.baseUrl });
        await writer.writeItem(document);
        for (const warning of document.warnings ?? []) {
          await context.warn(warning.code, warning.message, { ...warning.details, itemId: document.id });
        }
        contentProcessed = index + 1;
        state.contentProcessed = contentProcessed;
        if (contentProcessed % Math.max(1, progressEvery) === 0 || contentProcessed === contentCache.items.length) {
          await persistQuickState();
          await context.checkpoint({
            step: 'content_write',
            phase: 'content',
            cursor: contentProcessed,
            total: contentCache.items.length,
            resumable: true,
            resume: checkpointResumeParams({
              adapterId: resolvedAdapterId,
              config,
              safeQuery,
              contentTypes: types,
              perPage: normalizedSelection.perPage,
              maxItems: normalizedSelection.maxItems,
              includeTerms,
              includeAssets,
              mode: 'quick',
              selection: normalizedSelection,
              batchId,
              stage: 'content_write'
            }),
            details: { batchId, mode: 'quick', contentProcessed }
          });
        }
        if (contentProcessed % Math.max(1, progressEvery) === 0 || contentProcessed === contentCache.items.length) {
          await emitProgress(context, {
            phase: 'content',
            completed: contentProcessed,
            total: contentCache.items.length,
            bytes: selectionBytes(),
            message: `Quick scan: ${contentProcessed}/${contentCache.items.length} content item(s) normalized`,
            details: {
              mode: 'quick',
              contentProcessed,
              contentTotal: contentCache.items.length,
              requests: session.client?.requestCount ?? 0,
              bytesTransferred: selectionBytes()
            }
          });
        }
      }

      await context.phase('finalize');
      const metrics = session.client?.metrics?.() ?? { requests: 0, pages: 0, bytesTransferred: 0 };
      const counts = {
        posts: typeCounts.posts,
        pages: typeCounts.pages,
        categories: Object.keys(state.termLookup ?? {}).filter((key) => key.startsWith('category:')).length,
        tags: Object.keys(state.termLookup ?? {}).filter((key) => key.startsWith('tag:')).length,
        media: mediaById.size
      };
      const scope = {
        schema: 'qms-scan-scope@1',
        mode: 'quick',
        bounded: true,
        contentTypes: types,
        selection: {
          include: normalizedSelection.include,
          slug: normalizedSelection.slug,
          perPage: normalizedSelection.perPage,
          maxPages: normalizedSelection.maxPages,
          maxItems: normalizedSelection.maxItems
        },
        requested: normalizedSelection.maxItems,
        scanned: contentCache.items.length,
        postsScanned: typeCounts.posts,
        pagesScanned: typeCounts.pages,
        pagesFetched: metrics.pages,
        totalAvailable: state.availableByType,
        worstCasePages: normalizedSelection.worstCasePages,
        termsReferenced: Object.keys(state.termLookup ?? {}).length,
        termsRequested: (state.termIds.category?.length ?? 0) + (state.termIds.tag?.length ?? 0),
        mediaDependencies: mediaById.size,
        apiRequests: metrics.requests,
        bytesTransferred: metrics.bytesTransferred
      };
      const indexResult = await writer.finalizeIndex({
        site: validation.site ?? null,
        query: safeQuery,
        counts,
        unsupported,
        warnings: dedupeWarnings([...(validation.warnings ?? []), ...(session.warnings?.() ?? [])]),
        truncated: false,
        mode: 'quick',
        scope,
        metrics
      });
      summary = indexResult.summary;
      const report = {
        schema: DISCOVERY_REPORT_SCHEMA,
        version: 1,
        adapter: resolvedAdapterId,
        adapterVersion: adapter.version,
        contract: 'qms-source-adapter@1',
        mode: 'quick',
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
        truncated: false,
        scope,
        metrics,
        batchDir: paths.batchDir
      };
      await atomicWriteJson(paths.reportFile, report);
      await writer.markBatch({ status: 'completed', report: { summary, scope } });
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
        mode: 'quick',
        scope,
        metrics,
        indexFile: path.relative(paths.batchDir, paths.indexFile),
        reportFile: path.relative(paths.batchDir, paths.reportFile),
        truncated: false,
        unsupported: unsupported.length,
        warnings: report.warnings.length
      });
      return {
        runId: context.runId,
        status: 'completed',
        batchId,
        mode: 'quick',
        paths: latest,
        summary,
        report,
        scope,
        metrics,
        events: completion.events
      };
    } catch (error) {
      const cancelled = isCancellation(error) || context.signal.aborted;
      const mapped = mapSourceError(error);
      const summaryText = writer.counts;
      if (cancelled) {
        const cancellation = await context.cancel(mapped.message);
        const paused = cancellation?.state === 'paused';
        await withBatchState(writer, paused ? 'paused' : 'cancelled', summaryText, mapped.toJSON());
        return {
          runId: context.runId,
          status: paused ? 'paused' : 'cancelled',
          batchId,
          batchDir: paths.batchDir,
          events: cancellation?.events ?? []
        };
      }
      await withBatchState(writer, 'failed', summaryText, mapped.toJSON());
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

  /**
   * Full site inventory. This is explicit and long-running. It is resumable at
   * terms/assets/content page boundaries and reuses the same batch journal.
   */
  async _discoverFull({
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
    resume = null,
    resumeFrom = null,
    signal = null
  } = {}) {
    const project = this.getProject();
    const resolvedAdapterId = adapterId ?? project.source?.adapter ?? 'wordpress';
    const adapter = this.registry.get(resolvedAdapterId);
    const config = mergeSourceConfig(project.source, source, resolvedAdapterId);
    const safeQuery = sanitizeQuery(query);
    const requestedTypes = contentTypes ?? adapter.getCapabilities().contentTypes ?? [];
    const resumeInfo = this._resumeInfo(resume, resumeFrom);
    const startedAt = this.clock.nowIso();
    const context = await this.runs.start({
      kind: 'source.discover',
      phase: 'connect',
      meta: {
        adapterId: resolvedAdapterId,
        baseUrl: config.baseUrl ?? null,
        query: safeQuery,
        mode: 'full',
        maxItems
      }
    });
    const cleanup = linkSignal(context, signal);
    const batchId = resumeInfo.batchId ?? batchIdForRun(context.runId);
    const paths = batchPaths(this.paths, resolvedAdapterId, batchId);
    const writer = new SourceBatchWriter({
      paths,
      adapterId: resolvedAdapterId,
      batchId,
      runId: context.runId,
      clock: this.clock,
      previousEntries: new Map(),
      resume: Boolean(resumeInfo.batchId)
    });
    let session = null;
    let summary = null;
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
        resume: checkpointResumeParams({
          adapterId: resolvedAdapterId,
          config,
          safeQuery,
          contentTypes: requestedTypes,
          perPage,
          maxItems,
          includeTerms,
          includeAssets,
          mode: 'full',
          selection: null,
          batchId,
          stage: 'connect'
        }),
        details: { adapterId: resolvedAdapterId, batchId, mode: 'full' }
      });
      session = await adapter.createSession({
        config,
        auth: auth ?? { mode: config.authMode ?? 'none' },
        signal: context.signal
      });
      const validation = await session.validate({ signal: context.signal });
      const counts = validation.counts ?? {};
      const unsupported = validation.unsupported ?? [];
      for (const warning of dedupeWarnings([...(validation.warnings ?? []), ...(session.warnings?.() ?? [])])) {
        await context.warn(warning.code, warning.message, warning.details ?? {});
      }
      for (const entry of unsupported) {
        await context.warn(entry.code ?? 'UNSUPPORTED_CONTENT_TYPE', entry.message ?? `Unsupported source content: ${entry.type ?? entry.feature ?? 'unknown'}`, {
          type: entry.type ?? null,
          feature: entry.feature ?? null,
          count: entry.count ?? null,
          supported: false
        });
      }
      await context.warn('SOURCE_CAPABILITY_REPORT', 'Source capability discovery completed.', {
        adapter: resolvedAdapterId,
        mode: 'full',
        counts,
        unsupported: unsupported.length
      });

      const stateFile = path.join(paths.batchDir, FULL_STATE_FILE);
      let state = resumeInfo.batchId ? await readState(stateFile, FULL_STATE_SCHEMA) : null;
      if (!state) {
        state = {
          schema: FULL_STATE_SCHEMA,
          version: 1,
          batchId,
          mode: 'full',
          termLookup: {},
          termsPages: {},
          termsDone: false,
          assetsPages: 0,
          assetsDone: false,
          contentPages: {},
          contentProcessed: 0,
          contentDone: false,
          truncated: false,
          updatedAt: null
        };
      }
      if (state.batchId !== batchId) {
        throw new QmsError(ERROR_CODES.RECOVERY_NOT_RESUMABLE, 'The full-scan checkpoint belongs to a different batch.', {
          details: { checkpointBatchId: state.batchId ?? null, batchId }
        });
      }
      const persistState = async () => {
        state.updatedAt = this.clock.nowIso();
        await atomicWriteJson(stateFile, state);
      };

      const termLookup = new Map(Object.entries(state.termLookup ?? {}));
      const attachmentCacheFile = path.join(paths.batchDir, ATTACHMENT_CACHE_FILE);
      const assetsByParent = await readAttachmentCache(attachmentCacheFile);
      let truncated = state.truncated === true;
      let written = writer.counts.items;
      const shouldStop = () => maxItems !== null && written >= maxItems;
      const noteTruncation = async () => {
        if (!truncated) {
          truncated = true;
          state.truncated = true;
          await persistState();
          await context.warn('SOURCE_ITEM_LIMIT_REACHED', 'Discovery stopped at the configured item limit; the batch is partial.', {
            maxItems,
            written
          });
        }
      };
      const writeDocument = async (document, phase, completed, total) => {
        assertContentDocument(document, { verifyHash: true, baseUrl: config.baseUrl });
        await writer.writeItem(document);
        for (const warning of document.warnings ?? []) {
          await context.warn(warning.code, warning.message, { ...warning.details, itemId: document.id });
        }
        written += 1;
        if (written % Math.max(1, progressEvery) === 0 || completed === total) {
          await emitProgress(context, {
            phase,
            completed,
            total,
            bytes: session.client?.bytesTransferred ?? 0,
            message: `${phase}: ${completed} item(s) normalized`,
            details: {
              mode: 'full',
              requests: session.client?.requestCount ?? 0,
              pages: session.client?.pageCount ?? 0,
              bytesTransferred: session.client?.bytesTransferred ?? 0
            }
          });
        }
      };

      if (includeTerms && !state.termsDone) {
        await context.phase('terms');
        const termTotal = Number.isInteger(counts.categories) && Number.isInteger(counts.tags)
          ? counts.categories + counts.tags
          : 0;
        let termCount = termLookup.size;
        const startPages = Object.fromEntries(Object.entries(state.termsPages ?? {}).map(([type, value]) => [type, (Number(value) || 0) + 1]));
        for await (const page of termPages(session, {
          taxonomies: ['category', 'tag'],
          perPage,
          startPages,
          fields: TERM_FIELDS,
          signal: context.signal
        })) {
          context.throwIfCancelled();
          if (shouldStop()) {
            await noteTruncation();
            break;
          }
          for (const item of page.items) {
            const key = `${item.taxonomy}:${item.raw.id}`;
            termLookup.set(key, { slug: item.raw.slug ?? null, name: item.raw.name ?? null });
            const document = session.normalizeTerm(item);
            const stored = await writer.writeItem(document);
            if (!stored?.skipped) {
              termCount += 1;
              written += 1;
            }
            if (shouldStop()) break;
          }
          state.termsPages[page.taxonomy] = (Number(state.termsPages[page.taxonomy]) || 0) + 1;
          state.termLookup = Object.fromEntries(termLookup.entries());
          await persistState();
          await context.checkpoint({
            step: 'terms_page',
            phase: 'terms',
            cursor: termCount,
            total: termTotal,
            resumable: true,
            resume: checkpointResumeParams({
              adapterId: resolvedAdapterId,
              config,
              safeQuery,
              contentTypes: requestedTypes,
              perPage,
              maxItems,
              includeTerms,
              includeAssets,
              mode: 'full',
              selection: null,
              batchId,
              stage: 'terms_page'
            }),
            details: { batchId, mode: 'full', termsPages: state.termsPages, termsDone: false }
          });
          await emitProgress(context, {
            phase: 'terms',
            completed: termCount,
            total: termTotal,
            bytes: session.client?.bytesTransferred ?? 0,
            message: `Full inventory: ${termCount} taxonomy term(s) indexed`,
            details: { mode: 'full', pages: session.client?.pageCount ?? 0, requests: session.client?.requestCount ?? 0 }
          });
          if (shouldStop()) {
            await noteTruncation();
            break;
          }
        }
        state.termsDone = true;
        state.termLookup = Object.fromEntries(termLookup.entries());
        await persistState();
        await context.checkpoint({
          step: 'terms_done',
          phase: 'terms',
          cursor: termCount,
          total: termTotal,
          resumable: true,
          resume: checkpointResumeParams({
            adapterId: resolvedAdapterId,
            config,
            safeQuery,
            contentTypes: requestedTypes,
            perPage,
            maxItems,
            includeTerms,
            includeAssets,
            mode: 'full',
            selection: null,
            batchId,
            stage: 'terms_done'
          }),
          details: { batchId, mode: 'full', termsPages: state.termsPages, termsDone: true }
        });
      }

      if (includeAssets && !state.assetsDone) {
        await context.phase('assets');
        const assetTotal = Number.isInteger(counts.media) ? counts.media : 0;
        let assetCount = writer.counts.items;
        const startPage = Math.max(1, Number(state.assetsPages || 0) + 1);
        for await (const page of assetPages(session, {
          perPage,
          page: startPage,
          fields: MEDIA_FIELDS,
          signal: context.signal
        })) {
          context.throwIfCancelled();
          if (shouldStop()) {
            await noteTruncation();
            break;
          }
          const cacheEntries = [];
          for (const item of page.items) {
            context.throwIfCancelled();
            const document = session.normalizeAsset(item);
            const parent = Number(item.raw.post ?? 0);
            if (parent > 0) cacheEntries.push({ post: parent, raw: item.raw });
            const stored = await writer.writeItem(document);
            if (parent > 0) {
              if (!assetsByParent.has(parent)) assetsByParent.set(parent, []);
              assetsByParent.get(parent).push(compactMedia(item.raw));
            }
            if (!stored?.skipped) {
              assetCount += 1;
              written += 1;
            }
            if (shouldStop()) break;
          }
          await appendAttachmentCache(attachmentCacheFile, cacheEntries);
          state.assetsPages = page.meta.page ?? startPage + (state.assetsPages - startPage + 1);
          await persistState();
          await context.checkpoint({
            step: 'assets_page',
            phase: 'assets',
            cursor: assetCount,
            total: assetTotal,
            resumable: true,
            resume: checkpointResumeParams({
              adapterId: resolvedAdapterId,
              config,
              safeQuery,
              contentTypes: requestedTypes,
              perPage,
              maxItems,
              includeTerms,
              includeAssets,
              mode: 'full',
              selection: null,
              batchId,
              stage: 'assets_page'
            }),
            details: { batchId, mode: 'full', assetsPage: state.assetsPages }
          });
          await emitProgress(context, {
            phase: 'assets',
            completed: assetCount,
            total: assetTotal,
            bytes: session.client?.bytesTransferred ?? 0,
            message: `Full inventory: ${assetCount} media item(s) indexed`,
            details: { mode: 'full', pages: session.client?.pageCount ?? 0, requests: session.client?.requestCount ?? 0 }
          });
          if (shouldStop()) {
            await noteTruncation();
            break;
          }
        }
        state.assetsDone = true;
        await persistState();
        await context.checkpoint({
          step: 'assets_done',
          phase: 'assets',
          cursor: assetCount,
          total: assetTotal,
          resumable: true,
          resume: checkpointResumeParams({
            adapterId: resolvedAdapterId,
            config,
            safeQuery,
            contentTypes: requestedTypes,
            perPage,
            maxItems,
            includeTerms,
            includeAssets,
            mode: 'full',
            selection: null,
            batchId,
            stage: 'assets_done'
          }),
          details: { batchId, mode: 'full', assetsPages: state.assetsPages, assetsDone: true }
        });
      }

      if (!state.contentDone) {
        await context.phase('content');
        const contentTotal = Number.isInteger(counts.posts) && Number.isInteger(counts.pages)
          ? counts.posts + counts.pages
          : 0;
        let contentCount = Number(state.contentProcessed) || 0;
        const startPages = Object.fromEntries(Object.entries(state.contentPages ?? {}).map(([type, value]) => [type, (Number(value) || 0) + 1]));
        for await (const page of contentPages(session, {
          contentTypes: requestedTypes,
          perPage,
          startPages,
          query: safeQuery,
          fields: CONTENT_FIELDS,
          signal: context.signal
        })) {
          context.throwIfCancelled();
          if (shouldStop()) {
            await noteTruncation();
            break;
          }
          for (const item of page.items) {
            context.throwIfCancelled();
            if (shouldStop()) {
              await noteTruncation();
              break;
            }
            const document = session.normalizeContent(item, {
              termLookup,
              attachments: assetsByParent.get(Number(item.raw.id)) ?? []
            });
            contentCount += 1;
            await writeDocument(document, 'content', contentCount, contentTotal);
          }
          state.contentPages[page.contentType] = page.meta.page ?? (Number(state.contentPages[page.contentType]) || 0) + 1;
          state.contentProcessed = contentCount;
          await persistState();
          await context.checkpoint({
            step: 'content_page',
            phase: 'content',
            cursor: contentCount,
            total: contentTotal,
            resumable: true,
            resume: checkpointResumeParams({
              adapterId: resolvedAdapterId,
              config,
              safeQuery,
              contentTypes: requestedTypes,
              perPage,
              maxItems,
              includeTerms,
              includeAssets,
              mode: 'full',
              selection: null,
              batchId,
              stage: 'content_page'
            }),
            details: {
              batchId,
              mode: 'full',
              contentPages: state.contentPages,
              pages: session.client?.pageCount ?? 0,
              requests: session.client?.requestCount ?? 0
            }
          });
          if (shouldStop()) break;
        }
        state.contentDone = true;
        await persistState();
      }

      await context.phase('finalize');
      const metrics = session.client?.metrics?.() ?? { requests: 0, pages: 0, bytesTransferred: 0 };
      const scope = {
        schema: 'qms-scan-scope@1',
        mode: 'full',
        bounded: false,
        contentTypes: requestedTypes,
        selection: null,
        requested: null,
        scanned: writer.counts.items,
        totalAvailable: counts,
        worstCasePages: null,
        termsReferenced: termLookup.size,
        mediaDependencies: counts.media ?? null,
        apiRequests: metrics.requests,
        bytesTransferred: metrics.bytesTransferred
      };
      const indexResult = await writer.finalizeIndex({
        site: validation.site ?? null,
        query: safeQuery,
        counts,
        unsupported,
        warnings: dedupeWarnings([...(validation.warnings ?? []), ...(session.warnings?.() ?? [])]),
        truncated,
        mode: 'full',
        scope,
        metrics
      });
      summary = indexResult.summary;
      const report = {
        schema: DISCOVERY_REPORT_SCHEMA,
        version: 1,
        adapter: resolvedAdapterId,
        adapterVersion: adapter.version,
        contract: 'qms-source-adapter@1',
        mode: 'full',
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
        scope,
        metrics,
        batchDir: paths.batchDir
      };
      await atomicWriteJson(paths.reportFile, report);
      await writer.markBatch({ status: 'completed', report: { summary, scope } });
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
        mode: 'full',
        scope,
        metrics,
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
        mode: 'full',
        paths: latest,
        summary,
        report,
        scope,
        metrics,
        events: completion.events
      };
    } catch (error) {
      const cancelled = isCancellation(error) || context.signal.aborted;
      const mapped = mapSourceError(error);
      const summaryText = writer.counts;
      if (cancelled) {
        const cancellation = await context.cancel(mapped.message);
        const paused = cancellation?.state === 'paused';
        await withBatchState(writer, paused ? 'paused' : 'cancelled', summaryText, mapped.toJSON());
        return {
          runId: context.runId,
          status: paused ? 'paused' : 'cancelled',
          batchId,
          batchDir: paths.batchDir,
          events: cancellation?.events ?? []
        };
      }
      await withBatchState(writer, 'failed', summaryText, mapped.toJSON());
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

  _resumeInfo(resume, resumeFrom) {
    if (resume && typeof resume === 'object' && typeof resume.batchId === 'string') {
      return { batchId: assertSafeSegment(resume.batchId, 'resume batch id'), stage: resume.stage ?? null };
    }
    if (resumeFrom && typeof resumeFrom === 'object') {
      const step = typeof resumeFrom.step === 'string' ? resumeFrom.step : null;
      const batchId = typeof resumeFrom.batchId === 'string' ? resumeFrom.batchId : null;
      if (!batchId) {
        if (step === null || step === 'connect') return { batchId: null, stage: 'connect' };
        throw new QmsError(
          ERROR_CODES.RECOVERY_NOT_RESUMABLE,
          'This checkpoint predates durable scan state and cannot be resumed safely. Start a bounded quick scan, or explicitly choose a new full inventory.',
          { details: { step } }
        );
      }
      return { batchId: assertSafeSegment(batchId, 'resume batch id'), stage: step };
    }
    return { batchId: null, stage: null };
  }
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function* contentPages(session, options) {
  if (typeof session.listContentPages === 'function') {
    yield* session.listContentPages(options);
    return;
  }
  const groups = new Map();
  for await (const item of session.listContent(options)) {
    const contentType = item.contentType ?? 'content';
    if (!groups.has(contentType)) groups.set(contentType, []);
    groups.get(contentType).push(item);
  }
  for (const [contentType, items] of groups.entries()) {
    yield { contentType, items, meta: { page: 1, total: items.length, totalPages: 1, count: items.length } };
  }
}

async function* termPages(session, options) {
  if (typeof session.listTermsPages === 'function') {
    yield* session.listTermsPages(options);
    return;
  }
  const groups = new Map();
  for await (const item of session.listTerms(options)) {
    const taxonomy = item.taxonomy ?? 'term';
    if (!groups.has(taxonomy)) groups.set(taxonomy, []);
    groups.get(taxonomy).push(item);
  }
  for (const [taxonomy, items] of groups.entries()) {
    yield { taxonomy, items, meta: { page: 1, total: items.length, totalPages: 1, count: items.length } };
  }
}

async function* assetPages(session, options) {
  if (typeof session.listAssetsPages === 'function') {
    yield* session.listAssetsPages(options);
    return;
  }
  const items = [];
  for await (const item of session.listAssets(options)) items.push(item);
  yield { items, meta: { page: 1, total: items.length, totalPages: 1, count: items.length } };
}

export { DISCOVERY_REPORT_SCHEMA };
