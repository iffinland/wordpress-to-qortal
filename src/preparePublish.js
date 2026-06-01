import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadConfig } from './config.js';
import { ensureDir, readJson, writeJson } from './utils/files.js';
import { safeFileName } from './convert.js';

const IDENTIFIER_MAX_LENGTH = 64;
const CONTENT_SERVICE = 'DOCUMENT';

function hashValue(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 10);
}

function makeIdentifier(prefix, seed, slug = '') {
  const suffix = hashValue(seed);
  const readable = safeFileName(slug, '').slice(0, 32);
  const identifier = [prefix, readable, suffix].filter(Boolean).join('-');
  return identifier.slice(0, IDENTIFIER_MAX_LENGTH).replace(/-+$/g, '');
}

function createContentResources(items, contentType) {
  return items.map((item) => ({
    type: contentType,
    source_id: item.source_id,
    old_url: item.old_url,
    service: CONTENT_SERVICE,
    identifier: makeIdentifier(`cr-${contentType}`, item.source_id, item.slug),
    local_path: `converted/${item.file}`,
    published: false
  }));
}

function createIndexResources() {
  return [
    ['qdn-manifest', 'converted/qdn-manifest.json'],
    ['posts-index', 'converted/posts-index.json'],
    ['pages-index', 'converted/pages-index.json'],
    ['categories', 'converted/categories.json'],
    ['tags', 'converted/tags.json'],
    ['media-map', 'converted/media-map.json'],
    ['url-map', 'converted/url-map.json'],
    ['import-manifest', 'converted/import-manifest.json']
  ].map(([name, localPath]) => ({
    type: 'index',
    service: CONTENT_SERVICE,
    identifier: `cr-${name}`,
    local_path: localPath,
    published: false
  }));
}

function createMediaResources(mediaMap) {
  const resources = [];
  const linkedOnly = [];

  for (const [sourceUrl, mediaItem] of Object.entries(mediaMap)) {
    if (!mediaItem.local_path || !mediaItem.sha256) {
      linkedOnly.push({
        source_url: sourceUrl,
        type: mediaItem.type,
        reason: 'Not downloaded; preserve as external link or resolve manually.'
      });
      continue;
    }

    const basename = path.basename(mediaItem.local_path, path.extname(mediaItem.local_path));
    resources.push({
      type: mediaItem.type,
      source_id: mediaItem.source_id || null,
      source_url: sourceUrl,
      service: mediaItem.qdn_service,
      identifier: makeIdentifier('cr-media', sourceUrl, basename),
      local_path: mediaItem.local_path,
      sha256: mediaItem.sha256,
      bytes: mediaItem.bytes || null,
      published: false
    });
  }

  return { resources, linkedOnly };
}

function createQdnManifest({ posts, pages, indexes, media, linkedOnly }) {
  const resources = [...posts, ...pages, ...indexes, ...media];
  const byPath = {};
  const byIdentifier = {};
  const bySourceUrl = {};

  for (const resource of resources) {
    const qdn = {
      type: resource.type,
      service: resource.service,
      identifier: resource.identifier
    };

    if (resource.local_path) {
      byPath[resource.local_path] = qdn;
    }

    if (resource.identifier) {
      byIdentifier[resource.identifier] = {
        ...qdn,
        local_path: resource.local_path || null,
        source_url: resource.source_url || null
      };
    }

    if (resource.source_url) {
      bySourceUrl[resource.source_url] = qdn;
    }
  }

  return {
    version: '0.1.4',
    generated_at: new Date().toISOString(),
    qdn_name: null,
    entrypoints: {
      posts_index: byPath['converted/posts-index.json'],
      pages_index: byPath['converted/pages-index.json'],
      categories: byPath['converted/categories.json'],
      tags: byPath['converted/tags.json'],
      media_map: byPath['converted/media-map.json'],
      url_map: byPath['converted/url-map.json']
    },
    resources: {
      by_path: byPath,
      by_identifier: byIdentifier,
      by_source_url: bySourceUrl
    },
    linked_only_media: linkedOnly,
    summary: {
      posts: posts.length,
      pages: pages.length,
      indexes: indexes.length,
      media: media.length,
      linked_only_media: linkedOnly.length,
      total_publish_resources: resources.length
    }
  };
}

async function main() {
  const config = loadConfig();
  const convertedDir = path.join(config.outputDir, 'converted');
  const publishLogDir = path.join(config.outputDir, 'publish-log');
  const postsIndex = await readJson(path.join(convertedDir, 'posts-index.json'));
  const pagesIndex = await readJson(path.join(convertedDir, 'pages-index.json'));
  const mediaMap = await readJson(path.join(convertedDir, 'media-map.json'));

  const posts = createContentResources(postsIndex, 'post');
  const pages = createContentResources(pagesIndex, 'page');
  const media = createMediaResources(mediaMap);
  const indexes = createIndexResources();
  const qdnManifest = createQdnManifest({
    posts,
    pages,
    indexes,
    media: media.resources,
    linkedOnly: media.linkedOnly
  });

  const plan = {
    version: '0.1.4',
    generated_at: new Date().toISOString(),
    qdn_name: null,
    note: 'Set the publishing Qortal name before implementing the publish command.',
    resources: {
      posts,
      pages,
      indexes,
      media: media.resources
    },
    linked_only_media: media.linkedOnly,
    summary: {
      posts: posts.length,
      pages: pages.length,
      indexes: indexes.length,
      media: media.resources.length,
      linked_only_media: media.linkedOnly.length,
      total_publish_resources: posts.length + pages.length + indexes.length + media.resources.length
    }
  };

  await ensureDir(publishLogDir);
  await writeJson(path.join(convertedDir, 'qdn-manifest.json'), qdnManifest);
  await writeJson(path.join(publishLogDir, 'publish-plan.json'), plan);
  await writeJson(path.join(publishLogDir, 'published-resources.json'), []);
  await writeJson(path.join(publishLogDir, 'errors.json'), []);

  console.log('');
  console.log('QDN publish preparation complete');
  console.log('');
  console.log(`Post resources: ${posts.length}`);
  console.log(`Page resources: ${pages.length}`);
  console.log(`Index resources: ${indexes.length}`);
  console.log(`Media resources: ${media.resources.length}`);
  console.log(`Linked-only media: ${media.linkedOnly.length}`);
  console.log(`Total resources planned: ${plan.summary.total_publish_resources}`);
  console.log('');
  console.log(`QDN manifest: ${path.join(convertedDir, 'qdn-manifest.json')}`);
  console.log(`Publish plan: ${path.join(publishLogDir, 'publish-plan.json')}`);
}

main().catch((error) => {
  console.error('');
  console.error('Publish preparation failed');
  console.error(error.message);
  process.exitCode = 1;
});
