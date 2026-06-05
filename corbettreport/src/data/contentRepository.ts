import { demoDataset } from './demoContent';
import { createQdnResourceUrl, fetchQdnResource, resolveQdnUrl } from '../qdn/qortalClient';
import { siteConfig } from '../config/site';
import type {
  CmsManifest,
  CmsPost,
  CmsPostIndexItem,
  CmsTerm,
  ContentPost,
  MigrationContentItem,
  MigrationIndexItem,
  MigrationMediaMap,
  MigrationQdnManifest,
  MigrationTerm,
  PublicPage,
  QdnResourceRef,
  SiteDataset
} from '../types/content';

const MANIFEST_SERVICE = 'DOCUMENT';
const MANIFEST_IDENTIFIER = 'cr-qdn-manifest';
const CMS_MANIFEST_IDENTIFIER = 'cms-manifest';

export interface ContentRepository {
  loadDataset: (refresh?: boolean) => Promise<SiteDataset>;
  findPost: (slug: string) => Promise<ContentPost | null>;
  findPage: (slug: string) => Promise<PublicPage | null>;
}

class DemoContentRepository implements ContentRepository {
  async loadDataset() {
    return demoDataset;
  }

  async findPost(slug: string) {
    return demoDataset.posts.find((post) => post.slug === slug) || null;
  }

  async findPage(slug: string) {
    return demoDataset.pages.find((page) => page.slug === slug) || null;
  }
}

class QdnMigrationRepository implements ContentRepository {
  private manifestPromise: Promise<MigrationQdnManifest> | null = null;
  private datasetPromise: Promise<SiteDataset> | null = null;
  private posts: MigrationIndexItem[] = [];
  private pages: MigrationIndexItem[] = [];
  private categories = new Map<number, string>();
  private tags = new Map<number, string>();
  private mediaMap: MigrationMediaMap = {};

  constructor(private readonly name: string) {}

  async loadDataset(refresh = false) {
    if (refresh) {
      this.manifestPromise = null;
      this.datasetPromise = null;
    }
    this.datasetPromise ??= this.loadDatasetOnce();
    return this.datasetPromise;
  }

  async findPost(slug: string) {
    await this.loadDataset();
    const item = this.posts.find((post) => post.slug === slug);
    return item ? this.loadPost(item) : null;
  }

  async findPage(slug: string) {
    await this.loadDataset();
    const item = this.pages.find((page) => page.slug === slug);
    if (!item) return null;
    const content = await this.loadContent(item);
    return {
      slug: content.slug,
      title: content.title,
      contentHtml: this.rewriteMediaUrls(content.content_html)
    };
  }

  private async loadDatasetOnce() {
    const manifest = await this.rememberManifest();
    const [posts, pages, categories, tags, mediaMap] = await Promise.all([
      this.loadRef<MigrationIndexItem[]>(manifest.entrypoints.posts_index),
      this.loadRef<MigrationIndexItem[]>(manifest.entrypoints.pages_index),
      this.loadRef<MigrationTerm[]>(manifest.entrypoints.categories),
      this.loadRef<MigrationTerm[]>(manifest.entrypoints.tags),
      this.loadRef<MigrationMediaMap>(manifest.entrypoints.media_map)
    ]);
    this.posts = posts;
    this.pages = pages;
    this.categories = new Map(categories.map((term) => [term.source_id, term.name]));
    this.tags = new Map(tags.map((term) => [term.source_id, term.name]));
    this.mediaMap = mediaMap;

    return {
      posts: posts
        .map((item) => this.toPost(item))
        .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt)),
      pages: pages.map((item) => ({
        slug: item.slug,
        title: item.title,
        contentHtml: ''
      })),
      documentaries: demoDataset.documentaries
    };
  }

  private async loadPost(item: MigrationIndexItem) {
    const content = await this.loadContent(item);
    return this.toPost(content, this.rewriteMediaUrls(content.content_html));
  }

  private toPost(item: MigrationIndexItem, contentHtml = ''): ContentPost {
    return {
      id: `wp-${item.source_id}`,
      slug: item.slug,
      title: item.title,
      excerpt: item.summary || (item as MigrationContentItem).excerpt_text || '',
      author: item.public_author || this.manifestValue?.public_author || siteConfig.publicAuthor,
      publishedAt: item.published_at || item.date,
      modifiedAt: item.modified_at || item.modified,
      importedAt: (item as MigrationContentItem).import?.imported_at,
      categories: (item.categories || []).map((id) => this.categories.get(id) || `Category ${id}`),
      tags: (item.tags || []).map((id) => this.tags.get(id) || `Tag ${id}`),
      image: this.featuredImageUrl(item.featured_media),
      contentHtml,
      source: 'migration'
    };
  }

  private featuredImageUrl(sourceId?: number | null) {
    if (!sourceId) return undefined;
    const match = Object.entries(this.mediaMap).find(([, item]) => item.source_id === sourceId);
    return match ? this.resolveMediaUrl(match[0]) : undefined;
  }

  private rewriteMediaUrls(contentHtml: string) {
    const document = new DOMParser().parseFromString(contentHtml || '', 'text/html');
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[src]'))) {
      const source = element.getAttribute('src');
      if (source) element.setAttribute('src', this.resolveMediaUrl(source));
      element.removeAttribute('srcset');
      element.removeAttribute('sizes');
    }
    for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      const href = link.getAttribute('href');
      if (href && this.mediaMap[href]) link.setAttribute('href', this.resolveMediaUrl(href));
    }
    return document.body.innerHTML;
  }

  private resolveMediaUrl(sourceUrl: string) {
    const ref = this.manifestValue?.resources.by_source_url[sourceUrl];
    if (!ref) return sourceUrl;
    return createQdnResourceUrl(ref.service, ref.name || this.name, ref.identifier);
  }

  private async loadContent(item: MigrationIndexItem) {
    const manifest = await this.loadManifest();
    const ref = manifest.resources.by_path[`converted/${item.file}`];
    if (!ref) throw new Error(`QDN catalog does not contain converted/${item.file}`);
    return this.loadRef<MigrationContentItem>(ref);
  }

  private loadManifest() {
    this.manifestPromise ??= fetchQdnResource<MigrationQdnManifest>(MANIFEST_SERVICE, this.name, MANIFEST_IDENTIFIER);
    return this.manifestPromise;
  }

  private manifestValue: MigrationQdnManifest | null = null;

  private async loadRef<T>(ref: QdnResourceRef) {
    return fetchQdnResource<T>(ref.service, ref.name || this.name, ref.identifier);
  }

  private async rememberManifest() {
    this.manifestValue = await this.loadManifest();
    return this.manifestValue;
  }
}

interface CmsDataset {
  manifest: CmsManifest;
  posts: CmsPostIndexItem[];
  pages: CmsPostIndexItem[];
  categories: CmsTerm[];
  tags: CmsTerm[];
}

class CmsQdnRepository implements ContentRepository {
  private datasetPromise: Promise<SiteDataset> | null = null;
  private posts: CmsPostIndexItem[] = [];
  private pages: CmsPostIndexItem[] = [];
  private categories = new Map<string, string>();
  private tags = new Map<string, string>();

  constructor(private readonly name: string) {}

  async loadDataset(refresh = false) {
    if (refresh) this.datasetPromise = null;
    this.datasetPromise ??= this.loadDatasetOnce();
    return this.datasetPromise;
  }

  async findPost(slug: string) {
    await this.loadDataset();
    const item = this.posts.find((post) => post.slug === slug);
    return item ? this.toPost(await this.loadContent(item)) : null;
  }

  async findPage(slug: string) {
    await this.loadDataset();
    const item = this.pages.find((page) => page.slug === slug);
    if (!item) return null;
    const content = await this.loadContent(item);
    return {
      slug: content.slug,
      title: content.title,
      contentHtml: this.rewriteQdnUrls(content.content_html)
    };
  }

  private async loadDatasetOnce() {
    const canonical = await this.loadSingleDataset(this.name);
    const operatorNames = [...new Set([
      ...siteConfig.coauthorNames,
      ...(canonical.manifest.coauthors || [])
    ])].filter((name) => normalizeQortalName(name) !== normalizeQortalName(this.name));
    const operators = (await Promise.all(operatorNames.map((name) =>
      this.loadSingleDataset(name, createOperatorIdentifier(CMS_MANIFEST_IDENTIFIER, canonical.manifest.site_id))
        .catch(() => null)
    ))).filter((dataset): dataset is CmsDataset => Boolean(
      dataset
      && normalizeQortalName(dataset.manifest.canonical_site_name || '') === normalizeQortalName(this.name)
    ));
    const dataset = operators.reduce(mergeCmsDatasets, canonical);

    this.posts = dataset.posts.filter((post) => post.status === 'published');
    this.pages = dataset.pages.filter((page) => page.status === 'published');
    this.categories = new Map(dataset.categories.map((term) => [term.id, term.name]));
    this.tags = new Map(dataset.tags.map((term) => [term.id, term.name]));

    return {
      posts: this.posts.map((post) => this.toPost(post)),
      pages: this.pages.map((page) => ({
        slug: page.slug,
        title: page.title,
        contentHtml: ''
      })),
      documentaries: demoDataset.documentaries
    };
  }

  private async loadSingleDataset(name: string, manifestIdentifier = CMS_MANIFEST_IDENTIFIER): Promise<CmsDataset> {
    const manifest = await fetchQdnResource<CmsManifest>('DOCUMENT', name, manifestIdentifier);
    const [posts, pages, categories, tags] = await Promise.all([
      this.loadOptionalRef<CmsPostIndexItem[]>(manifest.entrypoints.posts_index, name, []),
      this.loadOptionalRef<CmsPostIndexItem[]>(manifest.entrypoints.pages_index, name, []),
      this.loadOptionalRef<CmsTerm[]>(manifest.entrypoints.categories, name, []),
      this.loadOptionalRef<CmsTerm[]>(manifest.entrypoints.tags, name, [])
    ]);
    return { manifest, posts, pages, categories, tags };
  }

  private async loadContent(item: CmsPostIndexItem) {
    return fetchQdnResource<CmsPost>(item.qdn.service, item.qdn.name || this.name, item.qdn.identifier);
  }

  private async loadOptionalRef<T>(ref: QdnResourceRef, fallbackName: string, fallback: T) {
    return fetchQdnResource<T>(ref.service, ref.name || fallbackName, ref.identifier).catch(() => fallback);
  }

  private toPost(item: CmsPostIndexItem | CmsPost): ContentPost {
    return {
      id: item.id,
      slug: item.slug,
      title: item.title,
      excerpt: item.excerpt || '',
      author: item.author?.name || siteConfig.publicAuthor,
      publishedAt: item.published_at || item.created_at,
      modifiedAt: item.updated_at,
      categories: (item.category_ids || []).map((id) => this.categories.get(id) || id),
      tags: (item.tag_ids || []).map((id) => this.tags.get(id) || id),
      image: item.featured_image ? this.resolveRefUrl(item.featured_image) : undefined,
      contentHtml: 'content_html' in item ? this.rewriteQdnUrls(item.content_html) : '',
      source: 'cms'
    };
  }

  private resolveRefUrl(ref: QdnResourceRef) {
    return createQdnResourceUrl(ref.service, ref.name || this.name, ref.identifier);
  }

  private rewriteQdnUrls(contentHtml: string) {
    const document = new DOMParser().parseFromString(contentHtml || '', 'text/html');
    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[src], [href]'))) {
      for (const attribute of ['src', 'href']) {
        const value = element.getAttribute(attribute);
        if (value) element.setAttribute(attribute, resolveQdnUrl(value));
      }
    }
    return document.body.innerHTML;
  }
}

class QdnContentRepository implements ContentRepository {
  private readonly migration: QdnMigrationRepository;
  private readonly cms: CmsQdnRepository;
  private datasetPromise: Promise<SiteDataset> | null = null;
  private migrationAvailable = false;
  private cmsAvailable = false;

  constructor(name: string) {
    this.migration = new QdnMigrationRepository(name);
    this.cms = new CmsQdnRepository(name);
  }

  async loadDataset(refresh = false) {
    if (refresh) this.datasetPromise = null;
    this.datasetPromise ??= this.loadDatasetOnce();
    return this.datasetPromise;
  }

  async findPost(slug: string) {
    await this.loadDataset();
    const cmsPost = this.cmsAvailable ? await this.cms.findPost(slug).catch(() => null) : null;
    if (cmsPost) return cmsPost;
    return this.migrationAvailable ? this.migration.findPost(slug).catch(() => null) : null;
  }

  async findPage(slug: string) {
    await this.loadDataset();
    const cmsPage = this.cmsAvailable ? await this.cms.findPage(slug).catch(() => null) : null;
    if (cmsPage) return cmsPage;
    return this.migrationAvailable ? this.migration.findPage(slug).catch(() => null) : null;
  }

  private async loadDatasetOnce() {
    const [migration, cms] = await Promise.all([
      this.migration.loadDataset(true).catch(() => null),
      this.cms.loadDataset(true).catch(() => null)
    ]);
    this.migrationAvailable = Boolean(migration);
    this.cmsAvailable = Boolean(cms);
    if (!migration && !cms) {
      throw new Error(`No Corbett Report QDN catalogs were found under ${siteConfig.siteName}.`);
    }
    return mergeSiteDatasets(migration, cms);
  }
}

function normalizeQortalName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function safeIdentifierPart(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'site';
}

function createOperatorIdentifier(identifier: string, siteId: string) {
  return `cms-operator-${safeIdentifierPart(siteId)}-${identifier.replace(/^cms-/, '')}`.slice(0, 64);
}

function mergeCmsDatasets(base: CmsDataset, incoming: CmsDataset): CmsDataset {
  return {
    ...base,
    posts: mergeNewestById(base.posts, incoming.posts),
    pages: mergeNewestById(base.pages, incoming.pages),
    categories: mergeTermsBySlug(base.categories, incoming.categories),
    tags: mergeTermsBySlug(base.tags, incoming.tags)
  };
}

function mergeNewestById<T extends { id: string; updated_at: string }>(base: T[], incoming: T[]) {
  const byId = new Map(base.map((item) => [item.id, item]));
  for (const item of incoming) {
    const current = byId.get(item.id);
    if (!current || Date.parse(item.updated_at) >= Date.parse(current.updated_at)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function mergeTermsBySlug(base: CmsTerm[], incoming: CmsTerm[]) {
  const bySlug = new Map(base.map((term) => [term.slug, term]));
  for (const term of incoming) {
    if (!bySlug.has(term.slug)) bySlug.set(term.slug, term);
  }
  return [...bySlug.values()];
}

function mergeSiteDatasets(migration: SiteDataset | null, cms: SiteDataset | null): SiteDataset {
  const base = migration || { posts: [], pages: [], documentaries: demoDataset.documentaries };
  if (!cms) return base;
  return {
    posts: mergeContentBySlug(base.posts, cms.posts)
      .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt)),
    pages: mergeContentBySlug(base.pages, cms.pages),
    documentaries: base.documentaries
  };
}

function mergeContentBySlug<T extends { slug: string }>(base: T[], incoming: T[]) {
  const bySlug = new Map(base.map((item) => [item.slug, item]));
  for (const item of incoming) bySlug.set(item.slug, item);
  return [...bySlug.values()];
}

function createContentRepository() {
  const params = new URLSearchParams(window.location.search);
  const source = params.get('source') || import.meta.env.VITE_CONTENT_SOURCE || 'demo';
  const name = params.get('name') || import.meta.env.VITE_QDN_NAME || siteConfig.siteName;
  if (source === 'qdn') {
    if (!name) throw new Error('QDN content mode requires ?source=qdn&name=<QortalName>.');
    return new QdnContentRepository(name);
  }
  return new DemoContentRepository();
}

export const contentRepository: ContentRepository = createContentRepository();
