export interface ContentPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  author: string;
  publishedAt: string;
  modifiedAt: string;
  importedAt?: string;
  categories: string[];
  tags: string[];
  image?: string;
  heroImage?: string;
  contentHtml: string;
  commentsEnabled?: boolean;
  source: 'demo' | 'migration' | 'cms';
}

export interface Documentary {
  id: string;
  title: string;
  image: string;
  href: string;
}

export interface PublicPage {
  slug: string;
  title: string;
  contentHtml: string;
}

export interface SiteDataset {
  posts: ContentPost[];
  pages: PublicPage[];
  documentaries: Documentary[];
}

export interface QdnResourceRef {
  type?: string;
  service: string;
  identifier: string;
  name?: string;
}

export interface MigrationIndexItem {
  type: 'post' | 'page';
  source_id: number;
  old_url: string;
  public_author?: string;
  slug: string;
  title: string;
  date: string;
  published_at?: string;
  modified: string;
  modified_at?: string;
  summary?: string;
  categories?: number[];
  tags?: number[];
  featured_media?: number | null;
  file: string;
}

export interface MigrationContentItem extends MigrationIndexItem {
  excerpt_text?: string;
  content_html: string;
  import?: {
    imported_at?: string;
  };
}

export interface MigrationTerm {
  source_id: number;
  name: string;
  slug: string;
}

export interface MigrationMediaMapItem {
  source_id?: number;
  type: string;
  qdn_service: string;
  qdn_identifier?: string | null;
}

export type MigrationMediaMap = Record<string, MigrationMediaMapItem>;

export interface MigrationQdnManifest {
  qdn_name: string | null;
  canonical_site_name?: string | null;
  qdn_content_name?: string | null;
  qdn_media_name?: string | null;
  publisher_names?: string[];
  coauthor_names?: string[];
  public_author?: string;
  entrypoints: {
    posts_index: QdnResourceRef;
    pages_index: QdnResourceRef;
    categories: QdnResourceRef;
    tags: QdnResourceRef;
    media_map: QdnResourceRef;
  };
  resources: {
    by_path: Record<string, QdnResourceRef>;
    by_source_url: Record<string, QdnResourceRef>;
  };
}

export interface CmsPostIndexItem {
  id: string;
  type: 'post' | 'page';
  title: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  excerpt: string;
  category_ids: string[];
  tag_ids: string[];
  created_at: string;
  updated_at: string;
  published_at: string | null;
  qdn: QdnResourceRef;
  featured_image?: QdnResourceRef | null;
  author?: {
    name: string;
    address: string;
  };
}

export interface CmsPost extends CmsPostIndexItem {
  schema: 'qortal-cms/post@1';
  content_html: string;
  featured_image: QdnResourceRef | null;
  media: QdnResourceRef[];
  comments_enabled: boolean;
  author: {
    name: string;
    address: string;
  };
}

export interface CmsTerm {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface CmsManifest {
  schema: 'qortal-cms/manifest@1';
  site_id: string;
  title: string;
  tagline: string;
  owner_name: string;
  canonical_site_name?: string;
  coauthors: string[];
  version: string;
  updated_at: string;
  entrypoints: {
    posts_index: QdnResourceRef;
    pages_index: QdnResourceRef;
    categories: QdnResourceRef;
    tags: QdnResourceRef;
  };
}

export interface SearchResult {
  id: string;
  kind: 'post' | 'page' | 'category';
  title: string;
  description: string;
  href: string;
}
