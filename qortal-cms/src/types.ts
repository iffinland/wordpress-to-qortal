export interface IndexItem {
  type: 'post' | 'page';
  source_id: number;
  old_url: string;
  slug: string;
  title: string;
  date: string;
  modified: string;
  status: string;
  file: string;
}

export interface Term {
  source_id: number;
  name: string;
  slug: string;
  count?: number;
}

export interface ContentItem extends IndexItem {
  source: string;
  excerpt: string;
  excerpt_text: string;
  content_html: string;
  content_text: string;
  summary: string;
  categories: number[];
  tags: number[];
  featured_media: number | null;
  attachments: Array<{
    source_id: number;
    source_url: string;
    media_type: string;
    mime_type: string;
    title: string;
  }>;
  links: {
    internal: string[];
    external: string[];
  };
  media: {
    images: string[];
    audio: string[];
    video: string[];
    documents: string[];
    embeds: string[];
  };
  import: {
    imported_at: string | null;
    importer_version: string;
  };
}

export interface MediaMapItem {
  type: string;
  local_path?: string;
  qdn_service: string;
  qdn_identifier: string | null;
  sha256?: string;
  bytes?: number;
  downloaded?: boolean;
  published: boolean;
}

export type MediaMap = Record<string, MediaMapItem>;

export interface QdnResourceRef {
  type: string;
  service: string;
  identifier: string;
  local_path?: string | null;
  source_url?: string | null;
}

export interface QdnManifest {
  qdn_name: string | null;
  entrypoints: {
    posts_index: QdnResourceRef;
    pages_index: QdnResourceRef;
    categories: QdnResourceRef;
    tags: QdnResourceRef;
    media_map: QdnResourceRef;
    url_map: QdnResourceRef;
  };
  resources: {
    by_path: Record<string, QdnResourceRef>;
    by_source_url: Record<string, QdnResourceRef>;
  };
}
