import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const batchRoot = path.resolve(process.env.CORBETT_BATCH_ROOT?.trim() || 'workspaces/corbettreport-batches');
const batchesDir = path.join(batchRoot, 'batches');
const receiptsDir = path.join(batchRoot, 'receipts');
const statePath = path.join(batchRoot, 'state.json');
const action = process.argv[2] || 'status';

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readFlag(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function normalizeWordPressTimestamp(value) {
  if (!value) return null;
  const normalized = /(?:z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function timestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '').replace('T', '_').replace(/:/g, '-');
}

function pad(value, length = 4) {
  return String(value).padStart(length, '0');
}

function relativeToRoot(filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function defaultState() {
  return {
    version: 2,
    batch_size: readPositiveInteger(process.env.CORBETT_BATCH_SIZE, 15),
    next_offset: readNonNegativeInteger(process.env.CORBETT_START_OFFSET, 0),
    next_before: null,
    latest_seen_after: null,
    historical_exhausted: false,
    batches: []
  };
}

function normalizeState(state) {
  const normalized = {
    ...defaultState(),
    ...state,
    version: 2,
    latest_seen_after:
      state.latest_seen_after || state.baseline?.newest_post_date || null,
    historical_exhausted:
      state.historical_exhausted ?? state.exhausted ?? false,
    batches: Array.isArray(state.batches) ? state.batches : []
  };
  delete normalized.exhausted;
  return normalized;
}

async function readState() {
  try {
    return normalizeState(JSON.parse(await readFile(statePath, 'utf8')));
  } catch {
    return defaultState();
  }
}

async function writeState(state) {
  await mkdir(batchRoot, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function runNpm(script, env) {
  const result = spawnSync('npm', ['run', script], {
    cwd: root,
    env,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error(`npm run ${script} failed.`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonIfPresent(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

function mergeNewestByKey(items, keyFn, dateFn = (item) => item.modified_at || item.modified || item.published_at || item.date || '') {
  const byKey = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    const current = byKey.get(key);
    const currentTime = current ? Date.parse(dateFn(current)) : Number.NEGATIVE_INFINITY;
    const nextTime = Date.parse(dateFn(item));
    if (!current || (Number.isFinite(nextTime) ? nextTime : 0) >= (Number.isFinite(currentTime) ? currentTime : 0)) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

function mergeTermsByIdOrSlug(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = item.source_id ?? item.slug ?? item.name;
    if (!key || byKey.has(key)) continue;
    byKey.set(key, item);
  }
  return [...byKey.values()];
}

function mergeObjects(sources) {
  return Object.assign({}, ...sources.filter(Boolean));
}

function sourcePathsForDirectory(directory) {
  return {
    manifest: path.join(directory, 'converted', 'qdn-manifest.json'),
    posts: path.join(directory, 'converted', 'posts-index.json'),
    pages: path.join(directory, 'converted', 'pages-index.json'),
    categories: path.join(directory, 'converted', 'categories.json'),
    tags: path.join(directory, 'converted', 'tags.json'),
    mediaMap: path.join(directory, 'converted', 'media-map.json')
  };
}

function sourcePathsForReceipt(directory) {
  return {
    manifest: path.join(directory, 'qdn-manifest.json'),
    posts: path.join(directory, 'posts-index.json'),
    pages: path.join(directory, 'pages-index.json'),
    categories: path.join(directory, 'categories.json'),
    tags: path.join(directory, 'tags.json'),
    mediaMap: path.join(directory, 'media-map.json')
  };
}

function manifestSourceCandidates(state, currentBatch) {
  const candidates = [];
  if (state.baseline?.source_dir) {
    candidates.push({ label: 'baseline', ...sourcePathsForDirectory(path.resolve(root, state.baseline.source_dir)) });
  }

  for (const batch of state.batches) {
    if (batch.number > currentBatch.number) continue;
    if (!['completed', 'prepared', 'building'].includes(batch.status)) continue;
    const outputDir = path.resolve(root, batch.output_dir);
    candidates.push({ label: `batch-${pad(batch.number)}`, ...sourcePathsForDirectory(outputDir) });
    if (batch.receipt_dir) {
      candidates.push({ label: `receipt-${pad(batch.number)}`, ...sourcePathsForReceipt(path.resolve(root, batch.receipt_dir)) });
    }
  }

  return candidates;
}

async function loadCatalogSource(candidate) {
  const manifest = await readJsonIfPresent(candidate.manifest);
  const posts = await readJsonIfPresent(candidate.posts);
  const pages = await readJsonIfPresent(candidate.pages);
  const categories = await readJsonIfPresent(candidate.categories);
  const tags = await readJsonIfPresent(candidate.tags);
  const mediaMap = await readJsonIfPresent(candidate.mediaMap);
  if (!manifest || !Array.isArray(posts)) return null;
  return {
    ...candidate,
    manifest,
    posts,
    pages: Array.isArray(pages) ? pages : [],
    categories: Array.isArray(categories) ? categories : [],
    tags: Array.isArray(tags) ? tags : [],
    mediaMap: mediaMap && typeof mediaMap === 'object' ? mediaMap : {}
  };
}

async function rebuildCumulativeImportCatalog(state, currentBatch) {
  const outputDir = path.resolve(root, currentBatch.output_dir);
  const sources = (await Promise.all(
    manifestSourceCandidates(state, currentBatch).map(loadCatalogSource)
  )).filter(Boolean);

  if (!sources.length) return;

  const current = sources.at(-1);
  const mergedPosts = mergeNewestByKey(sources.flatMap((source) => source.posts), (post) => post.source_id ?? post.old_url ?? post.slug)
    .sort((left, right) => Date.parse(right.published_at || right.date || '') - Date.parse(left.published_at || left.date || ''));
  const mergedPages = mergeNewestByKey(sources.flatMap((source) => source.pages), (page) => page.source_id ?? page.old_url ?? page.slug)
    .sort((left, right) => Date.parse(right.published_at || right.date || '') - Date.parse(left.published_at || left.date || ''));
  const mergedCategories = mergeTermsByIdOrSlug(sources.flatMap((source) => source.categories));
  const mergedTags = mergeTermsByIdOrSlug(sources.flatMap((source) => source.tags));
  const mergedMediaMap = mergeObjects(sources.map((source) => source.mediaMap));
  const resourcesByPath = mergeObjects(sources.map((source) => source.manifest.resources?.by_path));
  const resourcesByIdentifier = mergeObjects(sources.map((source) => source.manifest.resources?.by_identifier));
  const resourcesBySourceUrl = mergeObjects(sources.map((source) => source.manifest.resources?.by_source_url));
  const linkedOnly = new Map();

  for (const source of sources) {
    for (const item of source.manifest.linked_only_media || []) {
      if (!resourcesBySourceUrl[item.source_url]) linkedOnly.set(item.source_url, item);
    }
  }

  const catalogManifest = {
    ...current.manifest,
    generated_at: new Date().toISOString(),
    entrypoints: {
      ...current.manifest.entrypoints
    },
    resources: {
      by_path: resourcesByPath,
      by_identifier: resourcesByIdentifier,
      by_source_url: resourcesBySourceUrl
    },
    linked_only_media: [...linkedOnly.values()],
    summary: {
      ...(current.manifest.summary || {}),
      batches: sources.length,
      posts: mergedPosts.length,
      pages: mergedPages.length,
      media: Object.keys(mergedMediaMap).length,
      linked_only_media: linkedOnly.size,
      total_publish_resources: Object.keys(resourcesByPath).length,
      resources_by_path: Object.keys(resourcesByPath).length,
      resources_by_source_url: Object.keys(resourcesBySourceUrl).length
    }
  };

  await writeFile(path.join(outputDir, 'converted', 'posts-index.json'), `${JSON.stringify(mergedPosts, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outputDir, 'converted', 'pages-index.json'), `${JSON.stringify(mergedPages, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outputDir, 'converted', 'categories.json'), `${JSON.stringify(mergedCategories, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outputDir, 'converted', 'tags.json'), `${JSON.stringify(mergedTags, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outputDir, 'converted', 'media-map.json'), `${JSON.stringify(mergedMediaMap, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outputDir, 'converted', 'qdn-manifest.json'), `${JSON.stringify(catalogManifest, null, 2)}\n`, 'utf8');

  currentBatch.catalog_source_count = sources.length;
  currentBatch.catalog_post_count = mergedPosts.length;
  currentBatch.catalog_media_count = Object.keys(mergedMediaMap).length;
}

function pendingBatch(state) {
  return state.batches.find((batch) => batch.status === 'prepared') || null;
}

function unfinishedBatch(state) {
  return state.batches.find((batch) => ['building', 'failed'].includes(batch.status)) || null;
}

function postDates(posts) {
  return posts
    .map((post) => normalizeWordPressTimestamp(post.date_gmt || post.date))
    .filter(Boolean)
    .sort();
}

function batchEnvironment(outputDir, state, batchSize, recentLimit) {
  return {
    ...process.env,
    OUTPUT_DIR: outputDir,
    LIMIT_POSTS: String(batchSize),
    LIMIT_RECENT_POSTS: String(recentLimit),
    POSTS_OFFSET: state.next_before ? '0' : String(state.next_offset),
    POSTS_BEFORE: state.next_before || '',
    POSTS_AFTER: state.latest_seen_after || '',
    FETCH_HISTORICAL_POSTS: state.historical_exhausted ? 'false' : 'true',
    MEDIA_SCOPE: 'selected_posts',
    DOWNLOAD_MEDIA: 'true',
    DOWNLOAD_MEDIA_TYPES: 'image,audio,video,document,file',
    MIGRATION_PROFILE: 'corbettreport'
  };
}

async function createBatchRecord({ state, outputDir, batchNumber, batchSize, recentLimit, status }) {
  const posts = await readJson(path.join(outputDir, 'raw', 'wordpress-posts.json'));
  const dumpManifest = await readJson(path.join(outputDir, 'raw', 'dump-manifest.json'));
  const historicalIds = new Set(dumpManifest.post_source_ids?.historical || []);
  const recentIds = new Set(dumpManifest.post_source_ids?.recent || []);
  const historicalPosts = posts.filter((post) => historicalIds.has(post.id));
  const recentPosts = posts.filter((post) => recentIds.has(post.id));
  const dates = postDates(posts);
  const historicalDates = postDates(historicalPosts);
  const recentDates = postDates(recentPosts);

  return {
    number: batchNumber,
    status,
    started_at: new Date().toISOString(),
    output_dir: relativeToRoot(outputDir),
    offset: state.next_offset,
    requested_posts: batchSize,
    requested_recent_posts: recentLimit,
    post_count: posts.length,
    source_ids: posts.map((post) => post.id),
    newest_post_date: dates.at(-1) || null,
    oldest_post_date: dates[0] || null,
    historical_post_count: historicalPosts.length,
    historical_source_ids: historicalPosts.map((post) => post.id),
    historical_oldest_post_date: historicalDates[0] || null,
    recent_post_count: recentPosts.length,
    recent_source_ids: recentPosts.map((post) => post.id),
    recent_newest_post_date: recentDates.at(-1) || null,
    historical_exhausted_after_completion:
      state.historical_exhausted || historicalPosts.length < batchSize,
    qortal_name: process.env.QORTAL_NAME || 'Corbett',
    manifest_identifier: 'cr-qdn-manifest'
  };
}

async function latestUntrackedBatchDirectory(state) {
  const tracked = new Set(state.batches.map((batch) => path.resolve(root, batch.output_dir)));
  let entries = [];
  try {
    entries = await readdir(batchesDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(batchesDir, entry.name))
    .filter((directory) => !tracked.has(path.resolve(directory)))
    .sort()
    .reverse();

  for (const directory of candidates) {
    try {
      await readFile(path.join(directory, 'raw', 'dump-manifest.json'));
      await readFile(path.join(directory, 'converted', 'media-map.json'));
      return directory;
    } catch {
      // Ignore directories that never reached media preparation.
    }
  }

  return null;
}

async function createNextBatch() {
  const state = await readState();
  const pending = pendingBatch(state);
  if (pending) {
    throw new Error(`Batch ${pending.number} is still prepared. Publish and adopt it, then run npm run corbettreport:batch:complete.`);
  }
  const unfinished = unfinishedBatch(state);
  if (unfinished) {
    throw new Error(`Batch ${unfinished.number} is ${unfinished.status}. Resume it with npm run corbettreport:batch:retry.`);
  }
  const batchSize = readPositiveInteger(process.env.CORBETT_BATCH_SIZE, state.batch_size || 15);
  const recentLimit = readPositiveInteger(process.env.CORBETT_RECENT_LIMIT, 100);
  const batchNumber = state.batches.length + 1;
  const rangeStart = state.next_offset + 1;
  const rangeEnd = state.next_offset + batchSize;
  const folderName = `${timestamp()}_batch-${pad(batchNumber)}_posts-${pad(rangeStart, 6)}-${pad(rangeEnd, 6)}`;
  const outputDir = path.join(batchesDir, folderName);
  const env = batchEnvironment(outputDir, state, batchSize, recentLimit);

  await mkdir(outputDir, { recursive: true });
  console.log('');
  console.log(`Preparing Corbett Report batch ${batchNumber}`);
  console.log(`Historical WordPress offset: ${state.next_offset}`);
  if (state.next_before) console.log(`Historical cursor: posts before ${state.next_before}`);
  if (state.historical_exhausted) console.log('Historical migration: complete');
  console.log(`Requested historical posts: ${state.historical_exhausted ? 0 : batchSize}`);
  console.log(`Recent cursor: posts after ${state.latest_seen_after || 'not established yet'}`);
  console.log(`Maximum recent posts per batch: ${recentLimit}`);
  console.log(`Output directory: ${relativeToRoot(outputDir)}`);
  console.log('');

  runNpm('dump', env);
  const posts = await readJson(path.join(outputDir, 'raw', 'wordpress-posts.json'));
  if (!posts.length) {
    if (!state.historical_exhausted) state.historical_exhausted = true;
    await writeState(state);
    await rm(outputDir, { recursive: true, force: true });
    console.log('No new posts were found and the historical migration is complete.');
    return;
  }

  const batch = await createBatchRecord({
    state,
    outputDir,
    batchNumber,
    batchSize,
    recentLimit,
    status: 'building'
  });
  state.batch_size = batchSize;
  state.batches.push(batch);
  await writeState(state);

  try {
    for (const script of ['convert', 'plan-media', 'download-media', 'validate', 'validate:media', 'prepare-publish']) {
      runNpm(script, env);
    }
    await rebuildCumulativeImportCatalog(state, batch);
    batch.status = 'prepared';
    batch.prepared_at = new Date().toISOString();
    delete batch.failed_at;
    delete batch.failure;
    await writeState(state);
  } catch (error) {
    batch.status = 'failed';
    batch.failed_at = new Date().toISOString();
    batch.failure = error.message;
    await writeState(state);
    throw error;
  }

  console.log('');
  console.log('Batch prepared successfully.');
  console.log(`Folder to select in Migration Publisher: ${batch.output_dir}`);
  console.log(`Posts prepared: ${batch.post_count}`);
  console.log(`New posts included: ${batch.recent_post_count}`);
  console.log(`Historical posts included: ${batch.historical_post_count}`);
  console.log('After QDN publishing and CMS adoption, run:');
  console.log('npm run corbettreport:batch:complete');
}

async function retryBatch() {
  const state = await readState();
  if (pendingBatch(state)) {
    throw new Error('A prepared batch is already waiting for publishing and CMS adoption.');
  }

  let batch = unfinishedBatch(state);
  let outputDir = batch ? path.resolve(root, batch.output_dir) : await latestUntrackedBatchDirectory(state);
  if (!outputDir) {
    throw new Error('No failed or untracked batch directory is available for retry.');
  }

  const dumpManifest = await readJson(path.join(outputDir, 'raw', 'dump-manifest.json'));
  const batchSize = readPositiveInteger(dumpManifest.limits?.posts, state.batch_size || 15);
  const recentLimit = readPositiveInteger(dumpManifest.limits?.recent_posts, 100);
  const env = batchEnvironment(outputDir, state, batchSize, recentLimit);

  if (!batch) {
    const folderMatch = path.basename(outputDir).match(/_batch-(\d+)_/);
    const batchNumber = folderMatch ? Number.parseInt(folderMatch[1], 10) : state.batches.length + 1;
    batch = await createBatchRecord({
      state,
      outputDir,
      batchNumber,
      batchSize,
      recentLimit,
      status: 'failed'
    });
    state.batches.push(batch);
  }

  console.log(`Retrying Corbett Report batch ${batch.number}`);
  console.log(`Batch directory: ${batch.output_dir}`);
  console.log('Existing completed media files will be skipped.');

  try {
    for (const script of ['download-media', 'validate', 'validate:media', 'prepare-publish']) {
      runNpm(script, env);
    }
    await rebuildCumulativeImportCatalog(state, batch);
    batch.status = 'prepared';
    batch.prepared_at = new Date().toISOString();
    batch.retried_at = batch.prepared_at;
    delete batch.failed_at;
    delete batch.failure;
    await writeState(state);
  } catch (error) {
    batch.status = 'failed';
    batch.failed_at = new Date().toISOString();
    batch.failure = error.message;
    await writeState(state);
    throw error;
  }

  console.log('');
  console.log('Batch retry completed successfully.');
  console.log(`Folder to select in Migration Publisher: ${batch.output_dir}`);
  console.log(`Posts prepared: ${batch.post_count}`);
}

async function completeBatch() {
  const state = await readState();
  const batch = pendingBatch(state);
  if (!batch) {
    throw new Error('No prepared batch is waiting for completion.');
  }

  const historicalPostCount = batch.historical_post_count ?? batch.post_count ?? 0;
  const historicalOldestPostDate =
    batch.historical_oldest_post_date || batch.oldest_post_date || null;
  const historicalExhaustedAfterCompletion =
    batch.historical_exhausted_after_completion ??
    historicalPostCount < (batch.requested_posts || state.batch_size);

  batch.status = 'completed';
  batch.completed_at = new Date().toISOString();
  state.next_offset = batch.offset + historicalPostCount;
  state.next_before = historicalOldestPostDate || state.next_before || null;
  state.latest_seen_after =
    batch.recent_newest_post_date || state.latest_seen_after || batch.newest_post_date || null;
  state.historical_exhausted = historicalExhaustedAfterCompletion;
  await writeState(state);

  console.log(`Batch ${batch.number} marked completed.`);
  console.log(`Next WordPress offset: ${state.next_offset}`);
  if (state.next_before) console.log(`Next batch cursor: posts before ${state.next_before}`);
  if (state.latest_seen_after) console.log(`Recent-post cursor: posts after ${state.latest_seen_after}`);
  console.log('Create the next batch with: npm run corbettreport:batch:next');
}

async function copyIfPresent(source, destination) {
  try {
    await cp(source, destination, { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function cleanupBatch() {
  const state = await readState();
  const batch = [...state.batches].reverse().find((item) => item.status === 'completed' && !item.cleaned_at);
  if (!batch) {
    throw new Error('No completed batch is available for cleanup.');
  }

  const outputDir = path.resolve(root, batch.output_dir);
  const receiptDir = path.join(receiptsDir, `batch-${pad(batch.number)}`);
  await mkdir(receiptDir, { recursive: true });
  const receiptFiles = [
    ['raw/dump-manifest.json', 'dump-manifest.json'],
    ['converted/import-manifest.json', 'import-manifest.json'],
    ['converted/qdn-manifest.json', 'qdn-manifest.json'],
    ['converted/posts-index.json', 'posts-index.json'],
    ['converted/pages-index.json', 'pages-index.json'],
    ['converted/categories.json', 'categories.json'],
    ['converted/tags.json', 'tags.json'],
    ['converted/media-map.json', 'media-map.json'],
    ['publish-log/publish-plan.json', 'publish-plan.json'],
    ['logs/validation.json', 'validation.json'],
    ['logs/media-download-errors.json', 'media-download-errors.json']
  ];
  for (const [source, destination] of receiptFiles) {
    await copyIfPresent(path.join(outputDir, source), path.join(receiptDir, destination));
  }
  await rm(outputDir, { recursive: true, force: true });
  batch.cleaned_at = new Date().toISOString();
  batch.receipt_dir = relativeToRoot(receiptDir);
  await writeState(state);

  console.log(`Deleted local data for completed batch ${batch.number}.`);
  console.log(`Audit files retained in: ${batch.receipt_dir}`);
}

async function rebuildPreparedCatalog() {
  const state = await readState();
  const batch = pendingBatch(state) || [...state.batches].reverse().find((item) => item.status === 'completed');
  if (!batch) {
    throw new Error('No prepared or completed batch is available for catalog rebuild.');
  }

  await rebuildCumulativeImportCatalog(state, batch);
  batch.catalog_rebuilt_at = new Date().toISOString();
  await writeState(state);

  console.log(`Rebuilt cumulative import catalog for batch ${batch.number}.`);
  console.log(`Catalog posts: ${batch.catalog_post_count || 0}`);
  console.log(`Catalog media entries: ${batch.catalog_media_count || 0}`);
  console.log(`Folder to select in Migration Publisher: ${batch.output_dir}`);
}

async function initializeFromExistingBatch() {
  const sourceValue = readFlag('--from');
  if (!sourceValue) {
    throw new Error('Use --from=path/to/existing-batch-directory.');
  }
  const state = await readState();
  if (state.batches.length || state.baseline) {
    throw new Error('Batch state is already initialized.');
  }

  const sourceDir = path.resolve(root, sourceValue);
  const posts = await readJson(path.join(sourceDir, 'raw', 'wordpress-posts.json'));
  if (!posts.length) {
    throw new Error('The existing batch contains no WordPress posts.');
  }
  const dates = posts
    .map((post) => normalizeWordPressTimestamp(post.date_gmt || post.date))
    .filter(Boolean)
    .sort();
  if (!dates.length) {
    throw new Error('The existing batch has no usable WordPress post dates.');
  }

  state.next_offset = posts.length;
  state.next_before = dates[0];
  state.latest_seen_after = dates.at(-1);
  state.baseline = {
    initialized_at: new Date().toISOString(),
    source_dir: relativeToRoot(sourceDir),
    post_count: posts.length,
    source_ids: posts.map((post) => post.id),
    newest_post_date: dates.at(-1),
    oldest_post_date: dates[0]
  };
  await writeState(state);

  console.log(`Batch state initialized from ${state.baseline.source_dir}.`);
  console.log(`Existing posts recorded: ${posts.length}`);
  console.log(`Next batch will load posts before ${state.next_before}.`);
}

async function printStatus() {
  const state = await readState();
  const pending = pendingBatch(state);
  console.log(JSON.stringify({
    batch_root: relativeToRoot(batchRoot),
    batch_size: state.batch_size,
    next_offset: state.next_offset,
    next_before: state.next_before || null,
    latest_seen_after: state.latest_seen_after || null,
    historical_exhausted: state.historical_exhausted,
    baseline: state.baseline || null,
    pending_batch: pending,
    unfinished_batch: unfinishedBatch(state),
    completed_batches: state.batches.filter((batch) => batch.status === 'completed').length,
    total_batches: state.batches.length
  }, null, 2));
}

async function main() {
  if (action === 'next') return createNextBatch();
  if (action === 'retry') return retryBatch();
  if (action === 'catalog') return rebuildPreparedCatalog();
  if (action === 'init') return initializeFromExistingBatch();
  if (action === 'complete') return completeBatch();
  if (action === 'cleanup') return cleanupBatch();
  if (action === 'status') return printStatus();
  throw new Error(`Unknown batch action: ${action}`);
}

main().catch((error) => {
  console.error('');
  console.error('Corbett batch workflow failed');
  console.error(error.message);
  process.exitCode = 1;
});
