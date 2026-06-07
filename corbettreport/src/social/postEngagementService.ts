import { fetchQdnResource, hasQortalBridge, requestQortal, toBase64 } from '../qdn/qortalClient';
import type { CommentIdentity } from '../comments/commentService';

const LIKE_SERVICE = 'DOCUMENT';
const LIKE_PREFIX = 'cms-like';
const TIP_SERVICE = 'DOCUMENT';
const TIP_PREFIX = 'cr-tip';

interface QdnSearchResult {
  service?: string;
  name?: string;
  identifier?: string;
}

interface NameData {
  owner?: string;
}

export interface PostTipEvent {
  schema: 'corbettreport/post-tip@1';
  id: string;
  post_id: string;
  post_slug: string;
  post_title: string;
  amount_qort: number;
  recipient_name: string;
  recipient_address: string;
  sender: CommentIdentity;
  created_at: string;
  qdn: {
    service: string;
    name: string;
    identifier: string;
  };
}

function shortHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function safeIdPart(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'item';
}

function normalizeSearchResults(value: unknown): QdnSearchResult[] {
  if (Array.isArray(value)) return value as QdnSearchResult[];
  if (value && typeof value === 'object') {
    const resources = (value as { resources?: unknown }).resources;
    if (Array.isArray(resources)) return resources as QdnSearchResult[];
  }
  return [];
}

function likePrefix(postId: string) {
  return `${LIKE_PREFIX}-${shortHash(postId)}-`;
}

function tipPrefix() {
  return `${TIP_PREFIX}-`;
}

function isPostTipEvent(value: unknown): value is PostTipEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<PostTipEvent>;
  return event.schema === 'corbettreport/post-tip@1'
    && typeof event.id === 'string'
    && typeof event.post_id === 'string'
    && typeof event.post_slug === 'string'
    && typeof event.post_title === 'string'
    && typeof event.amount_qort === 'number'
    && typeof event.created_at === 'string';
}

export function postLikeIdentifier(postId: string, identity: CommentIdentity) {
  return `${likePrefix(postId)}${safeIdPart(identity.name || identity.address)}`;
}

export async function fetchPostLikeCount(postId: string) {
  if (!hasQortalBridge()) return 0;

  const response = await requestQortal<unknown>({
    action: 'SEARCH_QDN_RESOURCES',
    service: LIKE_SERVICE,
    mode: 'ALL',
    identifier: likePrefix(postId),
    prefix: true,
    limit: 200,
    offset: 0,
    reverse: true,
    includeMetadata: false,
    excludeBlocked: true
  });

  return normalizeSearchResults(response).length;
}

export async function hasPostLike(postId: string, identity: CommentIdentity) {
  if (!hasQortalBridge()) return false;
  const identifier = postLikeIdentifier(postId, identity);

  const response = await requestQortal<unknown>({
    action: 'SEARCH_QDN_RESOURCES',
    service: LIKE_SERVICE,
    mode: 'ALL',
    name: identity.name,
    identifier,
    prefix: false,
    limit: 10,
    offset: 0,
    reverse: true,
    includeMetadata: false,
    excludeBlocked: true
  });

  return normalizeSearchResults(response).some((resource) => resource.name === identity.name && resource.identifier === identifier);
}

export async function publishPostLike(input: {
  postId: string;
  postTitle: string;
  identity: CommentIdentity;
}) {
  const identifier = postLikeIdentifier(input.postId, input.identity);
  const payload = {
    id: identifier,
    identifier,
    post_id: input.postId,
    author_name: input.identity.name,
    author_address: input.identity.address,
    created_at: new Date().toISOString()
  };

  await requestQortal({
    action: 'PUBLISH_QDN_RESOURCE',
    name: input.identity.name,
    service: LIKE_SERVICE,
    identifier,
    data64: toBase64(JSON.stringify(payload, null, 2)),
    encoding: 'base64',
    title: `Like on ${input.postTitle || 'post'}`.slice(0, 55),
    description: 'CMS post like'
  });

  return payload;
}

export async function fetchQortBalance() {
  if (!hasQortalBridge()) return null;
  const balance = await requestQortal<number>({ action: 'GET_WALLET_BALANCE', coin: 'QORT' });
  return typeof balance === 'number' ? balance : null;
}

export async function resolveNameAddress(name: string) {
  if (!hasQortalBridge() || !name.trim()) return '';
  const response = await requestQortal<NameData>({ action: 'GET_NAME_DATA', name: name.trim() });
  return response?.owner || '';
}

export async function sendQortTip(input: { recipient: string; amount: number }) {
  return requestQortal({
    action: 'SEND_COIN',
    coin: 'QORT',
    recipient: input.recipient,
    amount: input.amount
  });
}

export async function publishPostTipEvent(input: {
  postId: string;
  postSlug: string;
  postTitle: string;
  amount: number;
  recipientName: string;
  recipientAddress: string;
  sender: CommentIdentity;
}) {
  const now = new Date().toISOString();
  const identifier = `${tipPrefix()}${shortHash(input.postId)}-${safeIdPart(input.sender.name || input.sender.address)}-${Date.now()}`.slice(0, 64);
  const payload: PostTipEvent = {
    schema: 'corbettreport/post-tip@1',
    id: identifier,
    post_id: input.postId,
    post_slug: input.postSlug,
    post_title: input.postTitle,
    amount_qort: input.amount,
    recipient_name: input.recipientName,
    recipient_address: input.recipientAddress,
    sender: input.sender,
    created_at: now,
    qdn: {
      service: TIP_SERVICE,
      name: input.sender.name,
      identifier
    }
  };

  await requestQortal({
    action: 'PUBLISH_QDN_RESOURCE',
    name: input.sender.name,
    service: TIP_SERVICE,
    identifier,
    data64: toBase64(JSON.stringify(payload, null, 2)),
    encoding: 'base64',
    title: `Tip on ${input.postTitle || 'post'}`.slice(0, 55),
    description: `${input.amount} QORT tip event`
  });

  return payload;
}

export async function loadRecentPostTips(limit = 5): Promise<PostTipEvent[]> {
  if (!hasQortalBridge()) return [];
  const response = await requestQortal<unknown>({
    action: 'SEARCH_QDN_RESOURCES',
    service: TIP_SERVICE,
    mode: 'ALL',
    identifier: tipPrefix(),
    prefix: true,
    limit: Math.max(limit * 4, 20),
    offset: 0,
    reverse: true,
    includeMetadata: false,
    excludeBlocked: true
  });

  const tips = await Promise.all(normalizeSearchResults(response).map(async (resource) => {
    const service = resource.service || TIP_SERVICE;
    const name = resource.name || '';
    const identifier = resource.identifier || '';
    if (!name || !identifier.startsWith(tipPrefix())) return null;

    try {
      const tip = await fetchQdnResource<unknown>(service, name, identifier);
      if (!isPostTipEvent(tip)) return null;
      return {
        ...tip,
        qdn: { service, name, identifier }
      };
    } catch {
      return null;
    }
  }));

  return tips
    .filter((tip): tip is PostTipEvent => Boolean(tip))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, limit);
}
