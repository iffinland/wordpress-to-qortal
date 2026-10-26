import path from 'node:path';
import { loadConfig } from './config.js';
import { readJson, writeJson, ensureDir } from './utils/files.js';

const REQUIRED_RAW_FILES = [
  'wordpress-posts.json',
  'wordpress-pages.json',
  'wordpress-categories.json',
  'wordpress-tags.json',
  'wordpress-media.json'
];

const REQUIRED_CONVERTED_FILES = [
  'posts-index.json',
  'pages-index.json',
  'categories.json',
  'tags.json',
  'media-map.json',
  'url-map.json',
  'import-manifest.json'
];

function addIssue(issues, level, message, context = {}) {
  issues.push({
    level,
    message,
    ...context
  });
}

async function readJsonOrIssue(filePath, issues, required = true) {
  try {
    return await readJson(filePath);
  } catch (error) {
    addIssue(issues, required ? 'error' : 'warning', error.message, { file: filePath });
    return null;
  }
}

async function main() {
  const config = loadConfig();
  const requireMedia = process.argv.includes('--require-media');
  const allowMissingMedia = process.argv.includes('--allow-missing-media');
  const issues = [];
  const rawDir = path.join(config.outputDir, 'raw');
  const convertedDir = path.join(config.outputDir, 'converted');
  const logsDir = path.join(config.outputDir, 'logs');

  await ensureDir(logsDir);

  for (const fileName of REQUIRED_RAW_FILES) {
    const data = await readJsonOrIssue(path.join(rawDir, fileName), issues);

    if (data && !Array.isArray(data)) {
      addIssue(issues, 'error', 'Raw file must contain a JSON array.', { file: fileName });
    }
  }

  for (const fileName of REQUIRED_CONVERTED_FILES) {
    await readJsonOrIssue(path.join(convertedDir, fileName), issues);
  }

  const postsIndex = (await readJsonOrIssue(path.join(convertedDir, 'posts-index.json'), issues)) || [];
  const pagesIndex = (await readJsonOrIssue(path.join(convertedDir, 'pages-index.json'), issues)) || [];
  const categories = (await readJsonOrIssue(path.join(convertedDir, 'categories.json'), issues)) || [];
  const tags = (await readJsonOrIssue(path.join(convertedDir, 'tags.json'), issues)) || [];
  const mediaMap = (await readJsonOrIssue(path.join(convertedDir, 'media-map.json'), issues)) || {};
  const urlMap = (await readJsonOrIssue(path.join(convertedDir, 'url-map.json'), issues)) || {};
  const rawPosts = (await readJsonOrIssue(path.join(rawDir, 'wordpress-posts.json'), issues)) || [];
  const contentFiles = new Set();

  for (const item of postsIndex) {
    if (!item.slug || !item.file || !item.source_id) {
      addIssue(issues, 'error', 'Post index item is missing slug, file, or source_id.', { item });
    }
    validateIndexItem(item, contentFiles, issues);
  }

  for (const item of pagesIndex) {
    if (!item.slug || !item.file || !item.source_id) {
      addIssue(issues, 'error', 'Page index item is missing slug, file, or source_id.', { item });
    }
    validateIndexItem(item, contentFiles, issues);
  }

  const knownCategoryIds = new Set(categories.map((item) => item.source_id));
  const knownTagIds = new Set(tags.map((item) => item.source_id));
  const usedCategoryIds = new Set(rawPosts.flatMap((post) => post.categories || []));
  const usedTagIds = new Set(rawPosts.flatMap((post) => post.tags || []));
  const missingCategoryIds = [...usedCategoryIds].filter((id) => !knownCategoryIds.has(id));
  const missingTagIds = [...usedTagIds].filter((id) => !knownTagIds.has(id));

  if (missingCategoryIds.length > 0) {
    addIssue(issues, 'warning', 'Some post category IDs are missing from categories.json.', {
      source_ids: missingCategoryIds
    });
  }

  if (missingTagIds.length > 0) {
    addIssue(issues, 'warning', 'Some post tag IDs are missing from tags.json. Increase LIMIT_TAGS.', {
      source_ids: missingTagIds
    });
  }

  for (const [url, item] of Object.entries(mediaMap)) {
    if (!url.startsWith('http')) {
      addIssue(issues, 'warning', 'Media URL is not absolute.', { url });
    }

    if (!item.qdn_service) {
      addIssue(issues, 'error', 'Media map item is missing qdn_service.', { url });
    }

    const sameSite = isSameSiteUrl(url, config.wordpressBaseUrl);
    const expectedDownload =
      requireMedia &&
      config.downloadMediaTypes.has(item.type || 'file') &&
      (config.downloadExternalMedia || sameSite);

    if (expectedDownload && (!item.local_path || !item.sha256 || !item.downloaded)) {
      addIssue(
        issues,
        allowMissingMedia ? 'warning' : 'error',
        'Expected media file is not downloaded; it will remain an external link.',
        { url }
      );
    }
  }

  for (const [url, item] of Object.entries(urlMap)) {
    if (!item.type) {
      addIssue(issues, 'error', 'URL map item is missing type.', { url });
    }
  }

  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');

  await writeJson(path.join(logsDir, 'validation.json'), {
    checked_at: new Date().toISOString(),
    errors,
    warnings
  });

  console.log('');
  console.log('Importer validation complete');
  console.log('');
  console.log(`Posts indexed: ${postsIndex.length}`);
  console.log(`Pages indexed: ${pagesIndex.length}`);
  console.log(`Categories available: ${categories.length}`);
  console.log(`Tags available: ${tags.length}`);
  console.log(`Media map entries: ${Object.keys(mediaMap).length}`);
  console.log(`Media files downloaded: ${Object.values(mediaMap).filter((item) => item.downloaded).length}`);
  console.log(`URL map entries: ${Object.keys(urlMap).length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log('');
  console.log(`Validation log: ${path.join(logsDir, 'validation.json')}`);

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

function validateIndexItem(item, contentFiles, issues) {
  if (!item.published_at) {
    addIssue(issues, 'error', 'Content index item is missing published_at.', { item });
  }
  if (contentFiles.has(item.file)) {
    addIssue(issues, 'error', 'Content index file path is duplicated.', { file: item.file });
  }
  contentFiles.add(item.file);
}

function isSameSiteUrl(url, baseUrl) {
  try {
    const sourceHost = new URL(url).hostname.replace(/^www\./, '');
    const siteHost = new URL(baseUrl).hostname.replace(/^www\./, '');
    return sourceHost === siteHost;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error('');
  console.error('Validation failed');
  console.error(error.message);
  process.exitCode = 1;
});
