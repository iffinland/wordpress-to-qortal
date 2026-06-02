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

function createContentResources(items, contentType, qdnContentName, resourcePrefix) {
  return items.map((item) => ({
    type: contentType,
    source_id: item.source_id,
    old_url: item.old_url,
    service: CONTENT_SERVICE,
    identifier: makeIdentifier(`${resourcePrefix}-${contentType}`, item.source_id, item.slug),
    ...(qdnContentName ? { name: qdnContentName } : {}),
    local_path: `converted/${item.file}`,
    published: false
  }));
}

function createIndexResources(qdnContentName, identifiers) {
  return [
    [identifiers.qdn_manifest, 'converted/qdn-manifest.json'],
    [identifiers.posts_index, 'converted/posts-index.json'],
    [identifiers.pages_index, 'converted/pages-index.json'],
    [identifiers.categories, 'converted/categories.json'],
    [identifiers.tags, 'converted/tags.json'],
    [identifiers.media_map, 'converted/media-map.json'],
    [identifiers.url_map, 'converted/url-map.json'],
    [identifiers.import_manifest, 'converted/import-manifest.json']
  ].map(([identifier, localPath]) => ({
    type: 'index',
    service: CONTENT_SERVICE,
    identifier,
    ...(qdnContentName ? { name: qdnContentName } : {}),
    local_path: localPath,
    published: false
  }));
}

function createMediaResources(mediaMap, qdnContentName, qdnMediaName, resourcePrefix) {
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
    const useDedicatedMediaName = qdnMediaName && ['audio', 'video'].includes(mediaItem.type);
    resources.push({
      type: mediaItem.type,
      source_id: mediaItem.source_id || null,
      source_url: sourceUrl,
      service: mediaItem.qdn_service,
      identifier: makeIdentifier(`${resourcePrefix}-media`, sourceUrl, basename),
      ...(useDedicatedMediaName
        ? { name: qdnMediaName }
        : qdnContentName
          ? { name: qdnContentName }
          : {}),
      local_path: mediaItem.local_path,
      sha256: mediaItem.sha256,
      bytes: mediaItem.bytes || null,
      published: false
    });
  }

  return { resources, linkedOnly };
}

function createQdnManifest({
  posts,
  pages,
  indexes,
  media,
  linkedOnly,
  profileId,
  resourcePrefix,
  identifiers,
  qdnName,
  qdnSiteName,
  qdnContentName,
  qdnMediaName,
  qortalPublisherNames,
  qortalCoauthorNames,
  publicAuthorName
}) {
  const resources = [...posts, ...pages, ...indexes, ...media];
  const byPath = {};
  const byIdentifier = {};
  const bySourceUrl = {};

  for (const resource of resources) {
    const qdn = {
      type: resource.type,
      service: resource.service,
      identifier: resource.identifier,
      ...(resource.name || qdnName ? { name: resource.name || qdnName } : {})
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
    version: '0.1.5',
    generated_at: new Date().toISOString(),
    profile_id: profileId,
    identifier_prefix: resourcePrefix,
    identifiers,
    qdn_name: qdnName || null,
    canonical_site_name: qdnSiteName || null,
    qdn_content_name: qdnContentName || null,
    qdn_media_name: qdnMediaName || null,
    publisher_names: qortalPublisherNames,
    coauthor_names: qortalCoauthorNames,
    public_author: publicAuthorName,
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

  const posts = createContentResources(postsIndex, 'post', config.qortalContentName, config.resourcePrefix);
  const pages = createContentResources(pagesIndex, 'page', config.qortalContentName, config.resourcePrefix);
  const media = createMediaResources(
    mediaMap,
    config.qortalContentName,
    config.qortalMediaName,
    config.resourcePrefix
  );
  const indexes = createIndexResources(config.qortalContentName, config.qdnIdentifiers);
  const qdnManifest = createQdnManifest({
    posts,
    pages,
    indexes,
    media: media.resources,
    linkedOnly: media.linkedOnly,
    profileId: config.profileId,
    resourcePrefix: config.resourcePrefix,
    identifiers: config.qdnIdentifiers,
    qdnName: config.qortalName,
    qdnSiteName: config.qortalSiteName,
    qdnContentName: config.qortalContentName,
    qdnMediaName: config.qortalMediaName,
    qortalPublisherNames: config.qortalPublisherNames,
    qortalCoauthorNames: config.qortalCoauthorNames,
    publicAuthorName: config.publicAuthorName
  });

  const plan = {
    version: '0.1.5',
    generated_at: new Date().toISOString(),
    profile_id: config.profileId,
    identifier_prefix: config.resourcePrefix,
    identifiers: config.qdnIdentifiers,
    qdn_name: config.qortalName || null,
    canonical_site_name: config.qortalSiteName || null,
    qdn_content_name: config.qortalContentName || null,
    qdn_media_name: config.qortalMediaName || null,
    publisher_names: config.qortalPublisherNames,
    coauthor_names: config.qortalCoauthorNames,
    public_author: config.publicAuthorName,
    note: 'The browser publisher signs QDN writes through Qortal UI. Set QORTAL_NAME before preparation when exporting a collaborator manifest.',
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
