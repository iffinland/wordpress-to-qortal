import path from 'node:path';
import { loadConfig } from './config.js';
import {
  convertCategory,
  convertMediaItem,
  convertPage,
  convertPost,
  convertTag,
  countPostStats,
  createMediaMap,
  createPageIndexItem,
  createPostIndexItem,
  createContentFileName,
  createUrlMap,
} from './convert.js';
import { rewriteInternalLinks } from './utils/html.js';
import { ensureDir, readJson, resetDir, writeJson } from './utils/files.js';

function serializeError(error, context = {}) {
  return {
    ...context,
    name: error.name,
    message: error.message
  };
}

async function main() {
  const errors = [];
  const config = loadConfig();

  const rawPostsPath = path.join(config.outputDir, 'raw', 'wordpress-posts.json');
  const rawPagesPath = path.join(config.outputDir, 'raw', 'wordpress-pages.json');
  const rawCategoriesPath = path.join(config.outputDir, 'raw', 'wordpress-categories.json');
  const rawTagsPath = path.join(config.outputDir, 'raw', 'wordpress-tags.json');
  const rawMediaPath = path.join(config.outputDir, 'raw', 'wordpress-media.json');
  const convertedDir = path.join(config.outputDir, 'converted');
  const convertedPostsDir = path.join(convertedDir, 'posts');
  const convertedPagesDir = path.join(convertedDir, 'pages');
  const logsDir = path.join(config.outputDir, 'logs');

  await resetDir(convertedPostsDir);
  await resetDir(convertedPagesDir);
  await ensureDir(logsDir);

  const rawPosts = await readRawArray(rawPostsPath, errors, true);
  const rawPages = await readRawArray(rawPagesPath, errors);
  const rawCategories = await readRawArray(rawCategoriesPath, errors);
  const rawTags = await readRawArray(rawTagsPath, errors);
  const rawMedia = await readRawArray(rawMediaPath, errors);
  const mediaByParent = new Map();

  for (const rawMediaItem of rawMedia) {
    const parentId = rawMediaItem.post || 0;
    if (!mediaByParent.has(parentId)) {
      mediaByParent.set(parentId, []);
    }
    mediaByParent.get(parentId).push(rawMediaItem);
  }

  const convertedPosts = [];
  const convertedPages = [];

  for (const rawPost of rawPosts) {
    try {
      const convertedPost = convertPost(rawPost, config, mediaByParent.get(rawPost.id) || []);
      const fileName = createContentFileName(convertedPost);
      const outputPath = path.join(convertedPostsDir, fileName);

      await writeJson(outputPath, convertedPost);
      convertedPosts.push(convertedPost);
    } catch (error) {
      errors.push(serializeError(error, { source_id: rawPost.id || null }));
      console.error(`Failed to convert post ${rawPost.id}: ${error.message}`);
    }
  }

  for (const rawPage of rawPages) {
    try {
      const convertedPage = convertPage(rawPage, config);
      const fileName = createContentFileName(convertedPage);
      const outputPath = path.join(convertedPagesDir, fileName);

      await writeJson(outputPath, convertedPage);
      convertedPages.push(convertedPage);
    } catch (error) {
      errors.push(serializeError(error, { source_id: rawPage.id || null }));
      console.error(`Failed to convert page ${rawPage.id}: ${error.message}`);
    }
  }

  const convertedCategories = rawCategories.map(convertCategory);
  const convertedTags = rawTags.map(convertTag);
  const convertedMedia = rawMedia.map(convertMediaItem);
  const postsIndex = convertedPosts.map(createPostIndexItem);
  const pagesIndex = convertedPages.map(createPageIndexItem);
  const convertedPagesForMedia = config.mediaScope === 'selected_posts' ? [] : convertedPages;
  const generatedMediaMap = createMediaMap(convertedPosts, convertedPagesForMedia, convertedMedia);
  const existingMediaMap = await readOptionalJson(path.join(convertedDir, 'media-map.json'));
  const mediaMap = preserveDownloadedMedia(generatedMediaMap, existingMediaMap);
  const urlMap = createUrlMap({
    convertedPosts,
    convertedPages,
    convertedCategories,
    convertedTags,
    mediaMap
  });
  await rewriteConvertedContent(convertedPosts, convertedPostsDir, config.wordpressBaseUrl, urlMap);
  await rewriteConvertedContent(convertedPages, convertedPagesDir, config.wordpressBaseUrl, urlMap);

  await writeJson(path.join(convertedDir, 'posts-index.json'), postsIndex);
  await writeJson(path.join(convertedDir, 'pages-index.json'), pagesIndex);
  await writeJson(path.join(convertedDir, 'categories.json'), convertedCategories);
  await writeJson(path.join(convertedDir, 'tags.json'), convertedTags);
  await writeJson(path.join(convertedDir, 'media-map.json'), mediaMap);
  await writeJson(path.join(convertedDir, 'url-map.json'), urlMap);
  await writeJson(path.join(convertedDir, 'import-manifest.json'), {
    converted_at: new Date().toISOString(),
    importer_version: config.importerVersion,
    profile_id: config.profileId,
    identifier_prefix: config.resourcePrefix,
    wordpress_base_url: config.wordpressBaseUrl,
    public_author: config.publicAuthorName,
    counts: {
      posts_read: rawPosts.length,
      posts_converted: convertedPosts.length,
      pages_read: rawPages.length,
      pages_converted: convertedPages.length,
      categories: convertedCategories.length,
      tags: convertedTags.length,
      media_library_items: convertedMedia.length,
      media_map_entries: Object.keys(mediaMap).length,
      url_map_entries: Object.keys(urlMap).length
    },
    errors: errors.length
  });
  await writeJson(path.join(logsDir, 'errors.json'), errors);

  const stats = countPostStats([...convertedPosts, ...convertedPages]);

  console.log('');
  console.log('WordPress raw convert complete');
  console.log('');
  console.log(`Posts read: ${rawPosts.length}`);
  console.log(`Posts converted: ${convertedPosts.length}`);
  console.log(`Pages read: ${rawPages.length}`);
  console.log(`Pages converted: ${convertedPages.length}`);
  console.log(`Categories converted: ${convertedCategories.length}`);
  console.log(`Tags converted: ${convertedTags.length}`);
  console.log(`Media library items mapped: ${convertedMedia.length}`);
  console.log(`Category IDs found: ${stats.categoryIds.size}`);
  console.log(`Tag IDs found: ${stats.tagIds.size}`);
  console.log(`Images found: ${stats.images}`);
  console.log(`Audio files found: ${stats.audio}`);
  console.log(`Video files found: ${stats.video}`);
  console.log(`Documents found: ${stats.documents}`);
  console.log(`Embedded media found: ${stats.embeds}`);
  console.log(`Internal links found: ${stats.internalLinks}`);
  console.log(`External links found: ${stats.externalLinks}`);
  console.log(`Media map entries: ${Object.keys(mediaMap).length}`);
  console.log(`URL map entries: ${Object.keys(urlMap).length}`);
  console.log(`Errors: ${errors.length}`);
  console.log('');
  console.log(`Converted directory: ${convertedDir}`);
  console.log(`Import manifest: ${path.join(convertedDir, 'import-manifest.json')}`);
}

async function rewriteConvertedContent(items, outputDir, wordpressBaseUrl, urlMap) {
  for (const item of items) {
    item.content_html = rewriteInternalLinks(item.content_html, wordpressBaseUrl, urlMap);
    await writeJson(path.join(outputDir, createContentFileName(item)), item);
  }
}

main().catch((error) => {
  console.error('');
  console.error('Convert failed');
  console.error(error.message);
  process.exitCode = 1;
});

async function readRawArray(filePath, errors, required = false) {
  try {
    const data = await readJson(filePath);

    if (!Array.isArray(data)) {
      throw new Error('Raw file must contain a JSON array.');
    }

    return data;
  } catch (error) {
    errors.push(serializeError(error, { file: filePath }));

    if (required) {
      await writeJson(path.join(path.dirname(path.dirname(filePath)), 'logs', 'errors.json'), errors);
      throw new Error(`Could not read required raw file: ${filePath}`);
    }

    console.error(`Skipping optional raw file ${filePath}: ${error.message}`);
    return [];
  }
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return {};
  }
}

function preserveDownloadedMedia(generatedMediaMap, existingMediaMap) {
  const downloadedFields = ['local_path', 'sha256', 'bytes', 'downloaded', 'downloaded_at'];

  return Object.fromEntries(
    Object.entries(generatedMediaMap).map(([url, mediaItem]) => {
      const existing = existingMediaMap[url] || {};
      const preserved = {};

      for (const field of downloadedFields) {
        if (existing[field] !== undefined && existing[field] !== null) {
          preserved[field] = existing[field];
        }
      }

      return [url, { ...mediaItem, ...preserved }];
    })
  );
}
