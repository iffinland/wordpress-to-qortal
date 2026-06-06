import { fetchQdnResource, hasQortalBridge, requestQortal, toBase64 } from '../qdn/qortalClient';

const COMMENT_SERVICE = 'DOCUMENT';
const COMMENT_PREFIX = 'cr-comment';

interface QdnSearchResult {
  service?: string;
  name?: string;
  identifier?: string;
}

interface AccountName {
  name?: string;
}

export interface CommentIdentity {
  address: string;
  name: string;
}

export interface PostComment {
  schema: 'corbettreport/comment@1';
  id: string;
  post_id: string;
  body_text: string;
  status: 'published';
  created_at: string;
  updated_at: string;
  author: CommentIdentity;
  qdn: {
    service: string;
    name: string;
    identifier: string;
  };
}

function compactHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function commentPrefix(postId: string) {
  return `${COMMENT_PREFIX}-${compactHash(postId)}-`;
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeSearchResults(value: unknown): QdnSearchResult[] {
  if (Array.isArray(value)) return value as QdnSearchResult[];
  if (value && typeof value === 'object') {
    const resources = (value as { resources?: unknown }).resources;
    if (Array.isArray(resources)) return resources as QdnSearchResult[];
  }
  return [];
}

function isPostComment(value: unknown): value is PostComment {
  if (!value || typeof value !== 'object') return false;
  const comment = value as Partial<PostComment>;
  return comment.schema === 'corbettreport/comment@1'
    && typeof comment.id === 'string'
    && typeof comment.post_id === 'string'
    && typeof comment.body_text === 'string'
    && typeof comment.created_at === 'string'
    && typeof comment.updated_at === 'string'
    && comment.author !== null
    && typeof comment.author === 'object';
}

export function canUsePublicComments() {
  return hasQortalBridge();
}

export async function getCommentIdentity(): Promise<CommentIdentity | null> {
  if (!hasQortalBridge()) return null;

  const account = await requestQortal<{ address?: string; name?: string; primaryName?: string }>({ action: 'GET_USER_ACCOUNT' });
  const address = account?.address || '';
  const discoveredNames = new Set<string>();
  if (account?.name) discoveredNames.add(account.name);
  if (account?.primaryName) discoveredNames.add(account.primaryName);

  if (address) {
    const names = await requestQortal<Array<AccountName | string>>({ action: 'GET_ACCOUNT_NAMES', address }).catch(() => []);
    for (const item of names) {
      const name = typeof item === 'string' ? item : item.name || '';
      if (name) discoveredNames.add(name);
    }
  }

  const name = [...discoveredNames][0] || '';
  return address && name ? { address, name } : null;
}

export async function loadPostComments(postId: string): Promise<PostComment[]> {
  if (!hasQortalBridge()) return [];
  const prefix = commentPrefix(postId);
  const response = await requestQortal<unknown>({
    action: 'SEARCH_QDN_RESOURCES',
    service: COMMENT_SERVICE,
    mode: 'ALL',
    identifier: prefix,
    prefix: true,
    limit: 200,
    offset: 0,
    reverse: true,
    includeMetadata: false,
    excludeBlocked: true
  });

  const comments = await Promise.all(normalizeSearchResults(response).map(async (resource) => {
    const service = resource.service || COMMENT_SERVICE;
    const name = resource.name || '';
    const identifier = resource.identifier || '';
    if (!name || !identifier.startsWith(prefix)) return null;

    try {
      const comment = await fetchQdnResource<unknown>(service, name, identifier);
      if (!isPostComment(comment) || comment.post_id !== postId || comment.status !== 'published') return null;
      return {
        ...comment,
        author: { ...comment.author, name },
        qdn: { service, name, identifier }
      };
    } catch {
      return null;
    }
  }));

  return comments
    .filter((comment): comment is PostComment => Boolean(comment))
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
}

export async function publishPostComment(input: {
  postId: string;
  bodyText: string;
  identity: CommentIdentity;
  existing?: PostComment | null;
}): Promise<PostComment> {
  const bodyText = input.bodyText.trim();
  if (!bodyText) throw new Error('Comment cannot be empty.');
  if (input.existing && normalizeName(input.existing.author.name) !== normalizeName(input.identity.name)) {
    throw new Error('Only the comment author can edit this comment.');
  }

  const now = new Date().toISOString();
  const identifier = input.existing?.qdn.identifier
    || `${commentPrefix(input.postId)}${compactHash(`${input.identity.address}:${Date.now()}:${Math.random()}`)}`.slice(0, 64);
  const comment: PostComment = {
    schema: 'corbettreport/comment@1',
    id: input.existing?.id || identifier,
    post_id: input.postId,
    body_text: bodyText,
    status: 'published',
    created_at: input.existing?.created_at || now,
    updated_at: now,
    author: input.identity,
    qdn: {
      service: COMMENT_SERVICE,
      name: input.identity.name,
      identifier
    }
  };

  await requestQortal({
    action: 'PUBLISH_QDN_RESOURCE',
    service: COMMENT_SERVICE,
    name: input.identity.name,
    identifier,
    data64: toBase64(JSON.stringify(comment, null, 2)),
    encoding: 'base64',
    title: `Comment on Corbett Report post ${input.postId}`,
    description: bodyText.slice(0, 240)
  });

  return comment;
}
