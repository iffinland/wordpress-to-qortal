export type CmsStatus = 'draft' | 'published' | 'archived';
export type CmsRole = 'owner' | 'reader';

export interface QdnRef {
  service: string;
  identifier: string;
  name?: string;
}

export interface CmsTerm {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface CmsPostIndexItem {
  id: string;
  type: 'post' | 'page';
  title: string;
  slug: string;
  status: CmsStatus;
  excerpt: string;
  category_ids: string[];
  tag_ids: string[];
  created_at: string;
  updated_at: string;
  published_at: string | null;
  qdn: QdnRef;
}

export interface CmsPost extends CmsPostIndexItem {
  schema: 'qortal-cms/post@1';
  content_html: string;
  featured_image: QdnRef | null;
  media: QdnRef[];
  comments_enabled: boolean;
  author: {
    name: string;
    address: string;
  };
}

export interface CmsComment {
  schema: 'qortal-cms/comment@1';
  id: string;
  post_id: string;
  post_identifier: string;
  body_html: string;
  status: 'published' | 'hidden';
  created_at: string;
  updated_at: string;
  author: {
    name: string;
    address: string;
  };
  qdn: QdnRef;
}

export interface CmsManifest {
  schema: 'qortal-cms/manifest@1';
  title: string;
  owner_name: string;
  owner_address: string;
  version: string;
  updated_at: string;
  entrypoints: {
    posts_index: QdnRef;
    pages_index: QdnRef;
    categories: QdnRef;
    tags: QdnRef;
    comments_index: QdnRef;
  };
}

export interface CmsDataset {
  manifest: CmsManifest;
  posts: CmsPostIndexItem[];
  pages: CmsPostIndexItem[];
  categories: CmsTerm[];
  tags: CmsTerm[];
  comments: CmsComment[];
  local_posts?: Record<string, CmsPost>;
}

export interface ViewerIdentity {
  address: string;
  name: string;
  role: CmsRole;
  bridgeAvailable: boolean;
}
