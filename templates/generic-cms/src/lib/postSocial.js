import { discoverHostedQdnResource, requestQortal } from './qortal.js';
import { buildSitePostUrl } from './crossPublish/plan.js';

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function postSocialTarget(config, item) {
  const deployment = discoverHostedQdnResource(config.deployment || { service: 'APP', name: config.admin.qdnName || config.site.ownerName, identifier: 'default' });
  if (!deployment.name) throw new Error('The published site identity is unavailable.');
  // A title/slug edit keeps engagement; another deployment or post never shares it.
  const key = await digest(JSON.stringify([deployment.service, deployment.name, deployment.identifier || 'default', config.site.id, item.id]));
  return { key, url: buildSitePostUrl({ deployment, slug: item.slug }) };
}

function checked(result) {
  if (result === false || result == null || result.error) throw new Error(result?.message || 'Qortal did not confirm the request.');
  return result;
}

export async function socialAccount() {
  const account = checked(await requestQortal({ action: 'GET_USER_ACCOUNT' }));
  if (!account.address) throw new Error('Connect a Qortal account to continue.');
  const result = await requestQortal({ action: 'GET_ACCOUNT_NAMES', address: account.address });
  const names = (Array.isArray(result) ? result : []).map((item) => typeof item === 'string' ? item : item.name).filter(Boolean);
  if (!names.length) throw new Error('A registered Qortal name is required.');
  return { name: names.includes(account.name) ? account.name : names[0], address: account.address };
}

export function socialPrefix(kind, key) { return `qms_${kind}_${key.slice(0, 40)}_`; }

export async function readSocialPage(kind, key, offset = 0, limit = 10) {
  const prefix = socialPrefix(kind, key);
  const rows = checked(await requestQortal({ action: 'SEARCH_QDN_RESOURCES', service: 'DOCUMENT', identifier: prefix, prefix: true, mode: 'ALL', limit, offset, reverse: true, excludeBlocked: true }));
  if (!Array.isArray(rows)) throw new Error('Qortal returned an invalid social resource list.');
  const entries = await Promise.all(rows.map(async (row) => {
    if (!row.name || !String(row.identifier || '').startsWith(prefix)) return null;
    try {
      const value = checked(await requestQortal({ action: 'FETCH_QDN_RESOURCE', service: 'DOCUMENT', name: row.name, identifier: row.identifier }));
      if (value?.schema !== 'qms-post-social@1' || value.key !== key || value.kind !== kind || value.authorName !== row.name) return null;
      if (kind === 'like' && row.identifier !== prefix + (await digest(row.name)).slice(0, 24)) return null;
      if (kind === 'comment' && (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 4000)) return null;
      return { ...value, authorName: row.name, identifier: row.identifier };
    } catch { throw new Error('Some social resources could not be read. Retry after QDN propagation.'); }
  }));
  return { entries: entries.filter(Boolean), nextOffset: offset + rows.length, hasMore: rows.length === limit };
}

export async function countPostLikes(key) {
  const names = new Set();
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const result = await readSocialPage('like', key, offset, 50);
    result.entries.forEach((entry) => names.add(entry.authorName));
    offset = result.nextOffset;
    if (!result.hasMore) return { count: names.size, hasMore: false };
  }
  return { count: names.size, hasMore: true };
}

export function newCommentIdentifier(key) { return socialPrefix('comment', key) + crypto.randomUUID(); }

export async function publishPostSocial(kind, key, account, { text = '', identifier = '' } = {}) {
  const body = text.trim();
  if (kind !== 'like' && kind !== 'comment') throw new Error('Unknown action.');
  if (kind === 'comment' && (!body || body.length > 4000)) throw new Error('Write a comment of 1–4000 characters.');
  const prefix = socialPrefix(kind, key);
  if (identifier && (!identifier.startsWith(prefix) || kind !== 'comment')) throw new Error('Invalid comment identifier.');
  const id = identifier || prefix + (kind === 'like' ? (await digest(account.name)).slice(0, 24) : crypto.randomUUID());
  const value = { schema: 'qms-post-social@1', kind, key, authorName: account.name, text: body, updatedAt: new Date().toISOString() };
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const data64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
  checked(await requestQortal({ action: 'PUBLISH_QDN_RESOURCE', service: 'DOCUMENT', name: account.name, identifier: id, data64, encoding: 'base64', title: kind === 'like' ? 'Post like' : 'Post comment' }, 300000));
  return { ...value, identifier: id };
}
