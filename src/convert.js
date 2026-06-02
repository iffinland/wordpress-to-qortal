import { inspectPostHtml } from './utils/html.js';
import { decodeHtmlText, toPlainText, truncateText } from './utils/text.js';

function normalizeWordPressTimestamp(utcValue, fallbackValue) {
  if (utcValue) {
    return /(?:z|[+-]\d\d:\d\d)$/i.test(utcValue) ? utcValue : `${utcValue}Z`;
  }
  return fallbackValue || null;
}

export function safeFileName(value, fallback) {
  return (value || fallback)
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

export function createContentFileName(item) {
  const slug = safeFileName(item.slug, `${item.type}-${item.source_id}`);
  return `${slug}--wp-${item.source_id}.json`;
}

export function createContentFilePath(item, folder) {
  return `${folder}/${createContentFileName(item)}`;
}

export function convertPost(
  post,
  { wordpressBaseUrl, importerVersion, publicAuthorName = 'Site Author' },
  attachments = []
) {
  const contentHtml = post.content?.rendered || '';
  const htmlInspection = inspectPostHtml(contentHtml, wordpressBaseUrl);

  return {
    type: 'post',
    source: 'wordpress',
    source_id: post.id,
    old_url: post.link || null,
    public_author: publicAuthorName,
    slug: post.slug,
    title: decodeHtmlText(post.title?.rendered || ''),
    date: post.date || null,
    published_at: normalizeWordPressTimestamp(post.date_gmt, post.date),
    modified: post.modified || null,
    modified_at: normalizeWordPressTimestamp(post.modified_gmt, post.modified),
    status: post.status || null,
    excerpt: post.excerpt?.rendered || '',
    excerpt_text: toPlainText(post.excerpt?.rendered || ''),
    content_html: contentHtml,
    content_text: toPlainText(contentHtml),
    summary: truncateText(toPlainText(post.excerpt?.rendered || contentHtml), 240),
    categories: post.categories || [],
    tags: post.tags || [],
    featured_media: post.featured_media || null,
    attachments: attachments.map((item) => ({
      source_id: item.id,
      source_url: item.source_url || null,
      media_type: item.media_type || null,
      mime_type: item.mime_type || null,
      title: item.title?.rendered || ''
    })),
    links: htmlInspection.links,
    media: {
      images: htmlInspection.images,
      audio: htmlInspection.audio,
      video: htmlInspection.video,
      documents: htmlInspection.documents,
      embeds: htmlInspection.embeds
    },
    import: {
      imported_at: new Date().toISOString(),
      importer_version: importerVersion
    }
  };
}

export function convertPage(page, { wordpressBaseUrl, importerVersion, publicAuthorName = 'Site Author' }) {
  const contentHtml = page.content?.rendered || '';
  const htmlInspection = inspectPostHtml(contentHtml, wordpressBaseUrl);

  return {
    type: 'page',
    source: 'wordpress',
    source_id: page.id,
    old_url: page.link || null,
    public_author: publicAuthorName,
    slug: page.slug,
    title: decodeHtmlText(page.title?.rendered || ''),
    date: page.date || null,
    published_at: normalizeWordPressTimestamp(page.date_gmt, page.date),
    modified: page.modified || null,
    modified_at: normalizeWordPressTimestamp(page.modified_gmt, page.modified),
    status: page.status || null,
    excerpt: page.excerpt?.rendered || '',
    excerpt_text: toPlainText(page.excerpt?.rendered || ''),
    content_html: contentHtml,
    content_text: toPlainText(contentHtml),
    summary: truncateText(toPlainText(page.excerpt?.rendered || contentHtml), 240),
    parent: page.parent || 0,
    menu_order: page.menu_order || 0,
    featured_media: page.featured_media || null,
    attachments: [],
    links: htmlInspection.links,
    media: {
      images: htmlInspection.images,
      audio: htmlInspection.audio,
      video: htmlInspection.video,
      documents: htmlInspection.documents,
      embeds: htmlInspection.embeds
    },
    import: {
      imported_at: new Date().toISOString(),
      importer_version: importerVersion
    }
  };
}

export function convertCategory(category) {
  return {
    type: 'category',
    source: 'wordpress',
    source_id: category.id,
    old_url: category.link || null,
    slug: category.slug,
    name: decodeHtmlText(category.name || ''),
    description: category.description || '',
    count: category.count || 0,
    parent: category.parent || 0,
    taxonomy: category.taxonomy || 'category'
  };
}

export function convertTag(tag) {
  return {
    type: 'tag',
    source: 'wordpress',
    source_id: tag.id,
    old_url: tag.link || null,
    slug: tag.slug,
    name: decodeHtmlText(tag.name || ''),
    description: tag.description || '',
    count: tag.count || 0,
    taxonomy: tag.taxonomy || 'post_tag'
  };
}

export function convertMediaItem(mediaItem) {
  return {
    type: 'media',
    source: 'wordpress',
    source_id: mediaItem.id,
    old_url: mediaItem.link || null,
    source_url: mediaItem.source_url || null,
    slug: mediaItem.slug,
    title: decodeHtmlText(mediaItem.title?.rendered || ''),
    date: mediaItem.date || null,
    modified: mediaItem.modified || null,
    status: mediaItem.status || null,
    media_type: mediaItem.media_type || null,
    mime_type: mediaItem.mime_type || null
  };
}

export function createContentIndexItem(item, folder) {
  return {
    type: item.type,
    source_id: item.source_id,
    old_url: item.old_url,
    public_author: item.public_author || 'Site Author',
    slug: item.slug,
    title: item.title,
    date: item.date,
    published_at: item.published_at || item.date,
    modified: item.modified,
    modified_at: item.modified_at || item.modified,
    status: item.status,
    summary: item.summary || '',
    categories: item.categories || [],
    tags: item.tags || [],
    featured_media: item.featured_media || null,
    file: createContentFilePath(item, folder)
  };
}

export function createPostIndexItem(post) {
  return createContentIndexItem(post, 'posts');
}

export function createPageIndexItem(page) {
  return createContentIndexItem(page, 'pages');
}

export function countPostStats(convertedPosts) {
  return convertedPosts.reduce(
    (totals, post) => {
      totals.images += post.media.images.length;
      totals.audio += post.media.audio.length;
      totals.video += post.media.video.length;
      totals.documents += post.media.documents.length;
      totals.embeds += post.media.embeds.length;
      totals.internalLinks += post.links.internal.length;
      totals.externalLinks += post.links.external.length;
      (post.categories || []).forEach((categoryId) => totals.categoryIds.add(categoryId));
      (post.tags || []).forEach((tagId) => totals.tagIds.add(tagId));
      return totals;
    },
    {
      images: 0,
      audio: 0,
      video: 0,
      documents: 0,
      embeds: 0,
      internalLinks: 0,
      externalLinks: 0,
      categoryIds: new Set(),
      tagIds: new Set()
    }
  );
}

function addMediaItem(mediaMap, url, type) {
  if (!url || mediaMap[url]) {
    return;
  }

  mediaMap[url] = {
    type,
    local_path: null,
    qdn_service: getQdnServiceForMediaType(type),
    qdn_identifier: null,
    sha256: null,
    published: false
  };
}

function getQdnServiceForMediaType(type) {
  if (type === 'image') {
    return 'IMAGE';
  }

  if (type === 'audio') {
    return 'AUDIO';
  }

  if (type === 'video') {
    return 'VIDEO';
  }

  return 'FILE';
}

function inferMediaTypeFromMime(mimeType) {
  if (!mimeType) {
    return 'file';
  }

  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }

  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  if (mimeType === 'application/pdf') {
    return 'document';
  }

  return 'file';
}

export function createMediaMap(convertedPosts, convertedPages = [], convertedMediaItems = []) {
  const mediaMap = {};

  for (const contentItem of [...convertedPosts, ...convertedPages]) {
    contentItem.media.images.forEach((url) => addMediaItem(mediaMap, url, 'image'));
    contentItem.media.audio.forEach((url) => addMediaItem(mediaMap, url, 'audio'));
    contentItem.media.video.forEach((url) => addMediaItem(mediaMap, url, 'video'));
    contentItem.media.documents.forEach((url) => addMediaItem(mediaMap, url, 'document'));
  }

  for (const mediaItem of convertedMediaItems) {
    if (!mediaItem.source_url) {
      continue;
    }

    addMediaItem(mediaMap, mediaItem.source_url, inferMediaTypeFromMime(mediaItem.mime_type));
    mediaMap[mediaItem.source_url].source_id = mediaItem.source_id;
    mediaMap[mediaItem.source_url].old_url = mediaItem.old_url;
    mediaMap[mediaItem.source_url].title = mediaItem.title;
    mediaMap[mediaItem.source_url].mime_type = mediaItem.mime_type;
  }

  return mediaMap;
}

export function createUrlMap({
  convertedPosts = [],
  convertedPages = [],
  convertedCategories = [],
  convertedTags = [],
  mediaMap = {}
} = {}) {
  const urlMap = {};

  for (const post of convertedPosts) {
    addUrlMapItem(urlMap, post.old_url, {
      type: 'post',
      source_id: post.source_id,
      slug: post.slug,
      qapp_route: `#/posts/${encodeURIComponent(post.slug)}`,
      file: createContentFilePath(post, 'posts'),
      qdn_identifier: null,
      published: false
    });
  }

  for (const page of convertedPages) {
    addUrlMapItem(urlMap, page.old_url, {
      type: 'page',
      source_id: page.source_id,
      slug: page.slug,
      qapp_route: `#/pages/${encodeURIComponent(page.slug)}`,
      file: createContentFilePath(page, 'pages'),
      qdn_identifier: null,
      published: false
    });
  }

  for (const category of convertedCategories) {
    addUrlMapItem(urlMap, category.old_url, {
      type: 'category',
      source_id: category.source_id,
      slug: category.slug,
      qapp_route: `#/category/${encodeURIComponent(category.slug)}`,
      file: 'categories.json',
      qdn_identifier: null,
      published: false
    });
  }

  for (const tag of convertedTags) {
    addUrlMapItem(urlMap, tag.old_url, {
      type: 'tag',
      source_id: tag.source_id,
      slug: tag.slug,
      qapp_route: `#/tag/${encodeURIComponent(tag.slug)}`,
      file: 'tags.json',
      qdn_identifier: null,
      published: false
    });
  }

  for (const [url, mediaItem] of Object.entries(mediaMap)) {
    addUrlMapItem(urlMap, url, {
      type: 'media',
      source_id: mediaItem.source_id || null,
      slug: null,
      file: mediaItem.local_path,
      qdn_identifier: mediaItem.qdn_identifier,
      published: mediaItem.published
    });
  }

  return urlMap;
}

function addUrlMapItem(urlMap, url, item) {
  if (!url) {
    return;
  }

  urlMap[url] = item;
}
