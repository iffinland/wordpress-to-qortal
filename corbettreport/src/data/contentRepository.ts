import { demoDataset } from './demoContent';
import { createQdnResourceUrl, fetchQdnResource } from '../qdn/qortalClient';
import { siteConfig } from '../config/site';
import type {
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

export interface ContentRepository {
  loadDataset: () => Promise<SiteDataset>;
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

  async loadDataset() {
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

function createContentRepository() {
  const params = new URLSearchParams(window.location.search);
  const source = params.get('source') || import.meta.env.VITE_CONTENT_SOURCE || 'demo';
  const name = params.get('name') || import.meta.env.VITE_QDN_NAME || siteConfig.siteName;
  if (source === 'qdn') {
    if (!name) throw new Error('QDN content mode requires ?source=qdn&name=<QortalName>.');
    return new QdnMigrationRepository(name);
  }
  return new DemoContentRepository();
}

export const contentRepository: ContentRepository = createContentRepository();
