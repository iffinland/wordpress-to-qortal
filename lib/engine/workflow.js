import path from 'node:path';
import { atomicWriteJson, readJsonIfExists } from './storage/atomic.js';
import { resolveLatestSourceBatch, readIndexEntries, readIndexedItem } from './source-index.js';
import { QmsError } from './errors.js';
import { stat, readFile } from 'node:fs/promises';
import { MediaDownloader } from '../media/downloader.js';
import { resolveProjectConfig } from './config.js';
import { load as loadHtml } from 'cheerio';
import { createHash } from 'node:crypto';

const ACTIVE = new Set(['scanning', 'preparing', 'verifying']);
const ACTIONABLE = new Set(['new', 'modified', 'route_changed', 'reserved']);
function problem(message, code = 'WORKFLOW_BLOCKED') { return new QmsError(code, message); }
function checked(result) {
  if (!result || ['failed', 'blocked', 'cancelled', 'paused', 'partial'].includes(result.status)) {
    throw problem(result?.error?.message ?? result?.errors?.[0]?.message ?? 'Preparation stopped. Review the issue and resume.', result?.error?.code ?? 'WORKFLOW_STOPPED');
  }
  return result;
}
export function normalizeWorkflowOptions(value = {}) {
  const mode = value.mode ?? 'sample';
  if (!['sample', 'range', 'archive'].includes(mode)) throw problem('Choose a content selection.');
  const limit = value.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw problem('Choose between 1 and 100 sample items.');
  const contentTypes = value.contentTypes ?? ['post'];
  if (!Array.isArray(contentTypes) || !contentTypes.length || contentTypes.some((type) => !['post', 'page'].includes(type))) throw problem('Select posts or pages.');
  const query = {};
  for (const key of ['after', 'before']) {
    if (!value[key]) continue;
    const date = Date.parse(value[key]);
    if (!Number.isFinite(date)) throw problem('Enter a valid date.');
    query[key] = new Date(date).toISOString();
  }
  if (query.after && query.before && query.after > query.before) throw problem('The start date is after the end date.');
  if (mode === 'range' && !query.after && !query.before) throw problem('Enter a date range.');
  const batchSize = value.batchSize ?? 15;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw problem('Invalid preparation batch size.');
  return { mode, limit, contentTypes: [...new Set(contentTypes)], ...query, batchSize };
}

export class WorkflowService {
  constructor(handle) { this.handle = handle; this.file = path.join(handle.paths.root, 'workflow.json'); this.active = false; this.pauseRequested = false; }
  async load() { return await readJsonIfExists(this.file) ?? { schema: 'qms-guided-workflow@1', status: 'draft', batches: [], cursor: 0 }; }
  async save(patch) {
    const state = { ...await this.load(), ...patch, updatedAt: new Date().toISOString() };
    await atomicWriteJson(this.file, state, { mode: 0o600 });
    return state;
  }
  async adoptLegacy() {
    const handoffs = await this.handle.publication.list();
    const latestHandoff = handoffs[0];
    if (latestHandoff) {
      const loaded = await this.handle.publication.get(latestHandoff.handoffId, { validate: false });
      const count = loaded.resources.filter((resource) => resource.kind === 'content').length;
      if (loaded.resources.length && loaded.resources.every((resource) => resource.status === 'remote_verified')) {
        return this.save({ status: 'published', stage: 'complete', total: count, cursor: count,
          message: 'Your existing publication is verified. Check for new content to continue this same website.' });
      }
      try {
        const bundle = await this.handle.publication.exportBundle(latestHandoff.handoffId);
        return this.save({ status: 'ready', stage: 'publish', total: count, cursor: 0, batchItemCount: count,
          handoffId: latestHandoff.handoffId, bundle, config: null,
          message: 'Your existing package is ready to continue. If you have already published it, import its confirmation or check publication before sending it again.' });
      } catch (error) {
        return this.save({ status: 'legacy', stage: 'legacy', message: 'This older publication needs reconciliation. Open Advanced tools → Publishing or Recovery to continue without changing its identities.', error: { code: error.code ?? 'WORKFLOW_LEGACY', message: error.message } });
      }
    }
    const plans = await this.handle.planning.list({ limit: 1 });
    if (plans[0]?.status === 'ready') {
      const { plan } = await this.handle.planning.get(plans[0].planId);
      const keys = plan.entries.filter((entry) => ACTIONABLE.has(entry.status) && entry.qdn).map((entry) => entry.sourceKey);
      if (keys.length) return this.save({ status: 'paused', stage: 'media', currentPlanId: plan.planId,
        batchId: plan.batchId, sourceKeys: keys, total: keys.length, cursor: 0,
        config: normalizeWorkflowOptions({ mode: 'sample', limit: Math.min(keys.length, 100), contentTypes: plan.filters.contentTypes, batchSize: Math.max(keys.length, 1) }),
        message: 'Your existing preparation was found. Continue it using the same project and saved identities.' });
    }
    return this.load();
  }
  async status() {
    if (!this.active && !await readJsonIfExists(this.file)) {
      this.adoptionPromise ??= this.adoptLegacy();
      await this.adoptionPromise;
    }
    const state = await this.load();
    if (ACTIVE.has(state.status) && !this.active) return this.save({ status: 'paused', message: 'Your previous session ended. Continue from the saved checkpoint.' });
    if (state.status === 'ready' && state.bundle && !this.active) {
      const expectedRoot = path.join(this.handle.paths.dataRoot, 'exports') + path.sep;
      const exists = state.bundle.absolutePath.startsWith(expectedRoot) && await stat(state.bundle.absolutePath).then(() => true, () => false);
      if (!exists) return this.save({ bundle: await this.handle.publication.exportBundle(state.handoffId) });
    }
    return { ...state, running: this.active };
  }
  async launch(status, task) {
    if (this.active) throw problem('This site already has a running preparation.');
    this.active = true;
    this.pauseRequested = false;
    try { await this.save({ status, error: null, message: status === 'scanning' ? 'Reading the selected content…' : 'Preparing your website…' }); }
    catch (error) { this.active = false; throw error; }
    this.promise = (async () => {
      try { await task(); }
      catch (error) { const saved = await this.load(); await this.save({ status: this.pauseRequested ? 'paused' : status === 'verifying' && saved.stage === 'publish' && saved.handoffId ? 'ready' : 'failed', error: this.pauseRequested ? null : { code: error.code ?? 'WORKFLOW_FAILED', message: error.message }, message: this.pauseRequested ? 'Paused. Your completed work is saved.' : 'Preparation needs attention.' }); }
      finally { this.active = false; }
    })();
    return this.load();
  }
  boundary() { if (this.pauseRequested) throw problem('Paused.', 'OPERATION_PAUSED'); }
  async pause() {
    this.pauseRequested = true;
    for (const run of this.handle.runs.list()) {
      if (run.state === 'running' && ['source.discover', 'plan.create', 'media.download', 'publication.verify'].includes(run.kind)) await this.handle.runs.pause(run.id).catch(() => {});
    }
    return this.save({ message: 'Stopping at the next safe boundary…' });
  }
  async preview(options, auth, { resume = false } = {}) {
    const old = await this.load();
    if (old.status === 'ready') throw problem('Finish or verify the current publication before preparing another selection.');
    const config = normalizeWorkflowOptions(options);
    const fingerprint = createHash('sha256').update(JSON.stringify({ config, source: this.handle.project.source, target: this.handle.project.target, website: this.handle.project.settings?.website })).digest('hex');
    return this.launch('scanning', async () => {
      await this.save({ config, fingerprint, stage: 'scan', ...(resume && old.fingerprint === fingerprint ? {} : { cursor: 0, batches: [], batchId: null, currentPlanId: null, preview: null }) });
      let discovery;
      if (resume && old.fingerprint === fingerprint) {
        const recovery = await this.handle.recovery.status();
        const candidate = recovery.candidates.find((entry) => entry.kind === 'source.discover' && entry.resumable && entry.runId);
        if (candidate) discovery = (await this.handle.recovery.resume(candidate.runId, { auth })).result;
      }
      if (resume && old.fingerprint === fingerprint && old.batchId) {
        const saved = await resolveLatestSourceBatch(this.handle.paths, this.handle.project.source.adapter);
        if (saved.batchId === old.batchId) discovery = { status: 'completed' };
      }
      if (!discovery) discovery = await this.handle.source.discover({ auth, mode: config.mode === 'sample' ? 'quick' : 'content',
        contentTypes: config.contentTypes, perPage: 100,
        selection: { maxItems: config.limit, maxPages: 1, perPage: 100 },
        query: { ...(config.after ? { after: config.after } : {}), ...(config.before ? { before: config.before } : {}) },
        maxItems: config.mode === 'sample' ? config.limit : 50000 });
      checked(discovery); this.boundary();
      const latest = await resolveLatestSourceBatch(this.handle.paths, this.handle.project.source.adapter);
      const index = await readIndexEntries(latest.indexJsonl, { maxEntries: 50001 });
      if (latest.truncated || index.truncated) throw problem('The selection reached the safety limit. Choose a narrower date range; this is not a complete archive.');
      const entries = index.entries.filter((item) => config.contentTypes.includes(item.contentType));
      const keys = entries.map((item) => item.sourceKey);
      await this.save({ sourceKeys: keys, batchId: latest.batchId, total: keys.length, stage: 'scan' });
      const preview = keys.length ? await this.handle.planning.create({ ...this.planOptions(config, keys.slice(0, config.batchSize)), persist: false }) : null;
      if (preview?.status === 'failed') checked(preview);
      this.boundary();
      await this.save({ status: 'review', stage: 'review', preview: preview?.plan ?? null, items: entries.slice(0, 100).map((entry) => ({ sourceKey: entry.sourceKey, title: entry.title, contentType: entry.contentType })),
        message: keys.length ? 'Review your selection, then prepare it for Qortal.' : 'No content matches this selection.' });
    });
  }
  planOptions(config, keys) {
    return { batchSize: config.batchSize, filters: { sourceKeys: keys, contentTypes: config.contentTypes },
      planning: { includeReserved: true, includePages: config.contentTypes.includes('page') }, estimateMedia: true };
  }
  async prepare(auth) {
    const state = await this.load();
    if (!state.batchId || !state.config) throw problem('Check your content selection first.');
    if (state.status === 'ready' || (state.stage === 'publish' && state.handoffId)) return this.save({ status: 'ready', message: 'Check the existing publication before preparing anything else.' });
    return this.launch('preparing', () => this.prepareNext(state));
  }
  async prepareNext(state) {
      const latest = await resolveLatestSourceBatch(this.handle.paths, this.handle.project.source.adapter);
      if (latest.batchId !== state.batchId) throw problem('The source inventory changed. Review a fresh selection first.');
      let current = await this.load();
      while (current.cursor < current.sourceKeys.length) {
        this.boundary();
        const keys = current.sourceKeys.slice(current.cursor, current.cursor + current.config.batchSize);
        if (!current.currentPlanId) {
          await this.save({ stage: 'plan', message: 'Checking the next content group…' });
          const planned = checked(await this.handle.planning.create({ ...this.planOptions(current.config, keys), persist: true }));
          if (!planned.plan?.stats.selected) {
            current = await this.save({ cursor: current.cursor + keys.length, currentPlanId: null });
            continue;
          }
          current = await this.save({ currentPlanId: planned.planId });
        }
        this.boundary();
        await this.save({ stage: 'media', message: 'Downloading and checking required pictures and files…' });
        checked(await this.handle.media.download({ planId: current.currentPlanId }));
        this.boundary();
        await this.save({ stage: 'package', message: 'Creating your Qortal publication package…' });
        const loaded = await this.handle.planning.get(current.currentPlanId);
        const selection = loaded.plan.entries.filter((entry) => ACTIONABLE.has(entry.status) && entry.qdn).map((entry) => entry.sourceKey);
        const handoff = await this.handle.publication.prepare({ planId: current.currentPlanId, selection });
        this.boundary();
        const bundle = await this.handle.publication.exportBundle(handoff.handoffId);
        await this.save({ status: 'ready', stage: 'publish', handoffId: handoff.handoffId, bundle, batchItemCount: keys.length,
          batches: [...current.batches.filter((batch) => batch.handoffId !== handoff.handoffId), { handoffId: handoff.handoffId, bundle, count: keys.length }],
          message: 'Your package is ready. Publish it with Migration Publisher in Qortal Hub, then choose its confirmation file here.' });
        return;
      }
      await this.save({ status: 'published', stage: 'complete', currentPlanId: null, message: 'All selected content is verified on Qortal. There is nothing left to prepare.' });
  }
  async verify(nodeUrl, auth, receipt = null) {
    const state = await this.load();
    if (!state.handoffId || state.stage !== 'publish' || state.status !== 'ready') throw problem('No publication package is ready for verification.');
    return this.launch('verifying', async () => {
      if (receipt) await this.handle.publication.importReceipt({ handoffId: state.handoffId, receipt });
      const result = await this.handle.publication.verify({ handoffId: state.handoffId, nodeUrl, attempts: 6, intervalMs: 3000 });
      this.boundary();
      if (!result.resources?.length || result.resources.some((resource) => resource.status !== 'remote_verified')) {
        await this.save({ status: 'ready', verification: result, message: 'Some resources are still spreading through Qortal or need attention. Check again later; do not republish the package.' });
        return;
      }
      const cursor = Math.min(state.total, state.cursor + state.batchItemCount);
      await this.save({ cursor, status: cursor >= state.total ? 'published' : 'paused', stage: cursor >= state.total ? 'complete' : 'next', currentPlanId: null,
        handoffId: null, bundle: null, batchItemCount: 0, verification: result, message: cursor >= state.total ? 'Your website is published and independently verified.' : 'This publication is verified. Continue to prepare the next group automatically.' });
      if (cursor < state.total) {
        this.boundary();
        await this.save({ status: 'preparing', message: 'The previous publication is verified. Preparing the next group…' });
        await this.prepareNext(await this.load());
      }
    });
  }
  async item(sourceKey, withImages = false) {
    const state = await this.load();
    if (!state.sourceKeys?.includes(sourceKey)) throw problem('This item is outside the current selection.');
    const latest = await resolveLatestSourceBatch(this.handle.paths, this.handle.project.source.adapter);
    if (latest.batchId !== state.batchId) throw problem('Review a fresh selection first.');
    const { entries } = await readIndexEntries(latest.indexJsonl);
    const entry = entries.find((item) => item.sourceKey === sourceKey);
    if (!entry) throw problem('Content not found.');
    const document = await readIndexedItem(latest.batchDir, entry, { baseUrl: this.handle.project.source.baseUrl });
    const images = [];
    const imageNotices = [];
    if (withImages) {
      const config = resolveProjectConfig(this.handle.project);
      const previewRoot = path.join(this.handle.paths.root, 'preview');
      const downloader = new MediaDownloader({ fetchImpl: this.handle.fetchImpl ?? globalThis.fetch,
        clock: this.handle.clock, diskProbe: this.handle.diskProbe,
        diskLimits: { ...config.disk, maxFileBytes: 2 * 1024 ** 2, maxBytesPerRun: 6 * 1024 ** 2 },
        mediaSettings: { ...config.media, maxRetries: 0, timeoutMs: 10000 }, baseUrl: this.handle.project.source.baseUrl,
        assetsDir: path.join(previewRoot, 'assets'), tmpDir: path.join(previewRoot, 'tmp') });
      const urls = [...new Set([document.media?.featured, ...(document.media?.images ?? [])]
        .filter(Boolean).map((image) => image.resolved_url ?? image.url).filter(Boolean))].slice(0, 3);
      for (const url of urls) {
        const result = await downloader.download(url, { maxFileBytes: 2 * 1024 ** 2, maxTotalBytes: 2 * 1024 ** 2 });
        if (result.status === 'verified' && /^image\/(png|jpeg|webp|gif|avif)(?:;|$)/i.test(result.mimeType ?? '')) {
          const data = await readFile(result.filePath);
          images.push('data:' + result.mimeType.split(';')[0] + ';base64,' + data.toString('base64'));
        } else imageNotices.push(result.message ?? 'A picture could not be previewed within the 2 MB limit.');
      }
    }
    // Parse in the engine, not in a browser DOM: even inert HTML parsers can
    // initiate image fetches. Only text and explicitly requested raster data
    // cross the preload boundary.
    const html = loadHtml(document.body?.html ?? '');
    html('script,style,iframe,object,embed,form').remove();
    html('p,div,li,br,h1,h2,h3,h4,blockquote').append('\n');
    const text = html('body').text().replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { title: document.title?.text ?? document.title ?? entry.title, text, media: document.media, images, imageNotices };
  }
}
