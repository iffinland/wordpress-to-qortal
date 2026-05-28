export type ContentType = 'post' | 'page';

export interface IndexItem {
  type: ContentType;
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

export interface Attachment {
  source_id: number;
  source_url: string;
  media_type: string;
  mime_type: string;
  title: string;
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
  attachments: Attachment[];
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
  qdn_identifier: string;
  sha256?: string;
  bytes?: number;
  downloaded?: boolean;
  published: boolean;
}

export type MediaMap = Record<string, MediaMapItem>;
