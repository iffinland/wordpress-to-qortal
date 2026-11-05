export interface CmsNavigationItem {
  label: string;
  href: string;
  adminOnly?: boolean;
}

export interface CmsTheme {
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    muted: string;
    accent: string;
    accentText: string;
    border: string;
    danger: string;
    warning: string;
  };
  fontFamily: string;
  headingFontFamily: string;
  radius: string;
  maxWidth: string;
}

export interface CmsTemplateConfig {
  schema: 'qms-cms-template-config@1';
  site: {
    id: string;
    title: string;
    tagline: string;
    description: string;
    ownerName: string;
    publicAuthor: string;
    footerText: string;
  };
  content: {
    source: 'qdn' | 'fixture';
    manifestIdentifier: string;
    legacyManifestIdentifier: string;
    staleAfterDays: number;
    pageSize: number;
  };
  navigation: CmsNavigationItem[];
  theme: CmsTheme;
  admin: {
    qdnName: string;
    requireOwnerForImport: boolean;
  };
}

export interface QdnRef {
  service: string;
  name?: string;
  identifier: string;
}

export type CatalogState = 'loading' | 'ready' | 'empty' | 'partial' | 'stale' | 'error';

export interface CatalogNotice {
  code: string;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface CmsTerm {
  id: string;
  name: string;
  slug: string;
  count?: number;
}

export interface CmsContentItem {
  id: string;
  type: 'post' | 'page';
  title: string;
  slug: string;
  status: string;
  excerpt: string;
  categoryIds: string[];
  tagIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  contentRef: QdnRef | null;
  featuredImageRef: QdnRef | null;
  contentHash: string | null;
  native?: boolean;
  legacy?: {
    sourceId?: number | null;
    oldUrl?: string | null;
    file?: string | null;
    publicAuthor?: string | null;
  };
}

export interface CmsMediaRef {
  url: string;
  qdn: QdnRef | null;
  role?: string;
  alt?: string | null;
}

export interface CmsDataset {
  state: CatalogState;
  source: 'qms-cms' | 'qms-qdn' | 'cr-qdn' | 'error' | 'fixture';
  site: {
    id: string;
    title: string;
    tagline: string;
    description: string;
    ownerName: string;
    publicAuthor: string;
  };
  manifest: unknown;
  generatedAt: string | null;
  loadedAt: string;
  fromCache?: boolean;
  cachedAt?: string | null;
  message?: string;
  notices: CatalogNotice[];
  availability: {
    posts: boolean;
    pages: boolean;
    categories: boolean;
    tags: boolean;
  };
  posts: CmsContentItem[];
  pages: CmsContentItem[];
  categories: CmsTerm[];
  tags: CmsTerm[];
  media: CmsMediaRef[];
  urls: {
    bySourceUrl: Record<string, QdnRef>;
  };
  nativeIndex?: unknown;
}

export interface LoadedContent {
  item: CmsContentItem;
  title: string;
  slug: string;
  html: string;
  excerptHtml: string;
  author: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  media: CmsMediaRef[];
  source: string;
}

export interface ViewerIdentity {
  role: 'owner' | 'reader';
  owner: boolean;
  address: string;
  name: string;
  names: string[];
  qdnName: string;
  bridgeAvailable: boolean;
  nameRecordStatus: 'verified' | 'unavailable' | 'mismatch' | 'none' | 'invalid';
  reason: string;
  message: string;
}

export interface AdoptionRecord {
  key: string;
  siteId: string;
  itemId: string;
  type: 'post' | 'page';
  slug: string;
  title: string;
  contentRef: QdnRef | null;
  sourceId: number | null;
  oldUrl: string | null;
  adoptedAt: string;
}

export type ArchiveRoute = {
  kind: 'archive';
  year?: number;
  month?: number;
  page: number;
};

export type AdminSection = 'overview' | 'settings' | 'editor' | 'galleries';

export type AppRoute =
  | { kind: 'home' }
  | { kind: 'posts'; page: number }
  | { kind: 'post'; slug: string }
  | { kind: 'page'; slug: string }
  | { kind: 'category'; slug: string; page: number }
  | { kind: 'tag'; slug: string; page: number }
  | ArchiveRoute
  | { kind: 'search'; query: string }
  | { kind: 'gallery'; slug?: string }
  | { kind: 'admin'; section?: AdminSection; id?: string }
  | { kind: 'not-found' };

export interface GalleryImage {
  service: string;
  name: string;
  identifier: string;
  mimeType?: string | null;
  bytes?: number | null;
  sha256?: string | null;
  caption?: string;
  alt?: string;
  width?: number | null;
  height?: number | null;
}

export interface Gallery {
  id: string;
  slug: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  images: GalleryImage[];
}

export interface GalleryCatalog {
  schema: 'qms-cms-gallery@1';
  version: number;
  revision: number;
  site_id: string;
  updated_at: string | null;
  galleries: Gallery[];
}
