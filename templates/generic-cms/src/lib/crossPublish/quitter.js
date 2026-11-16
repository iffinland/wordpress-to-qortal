/**
 * Quitter announcement contract (interoperability adapter).
 *
 * Verified against `Qortal/Quitter` master @ 4e4246c:
 *
 *   - `src/qapp-config.ts` / `AppWrapper.tsx`: appName 'quitter' with the public
 *     salt below; `src/constants/qdn.ts` uses POST under ROOT.
 *   - `src/utils/postQdn.ts` publishes a DOCUMENT with the payload
 *     `{ text, timestamp, name }` (optional `images`, max 2).
 *   - `src/components/Post.tsx` collapses the visible text at
 *     MAX_TEXT_LENGTH = 280 and linkifies bare `qortal://` URLs.
 *
 * Quitter has no publisher-side hard character limit, but the CMS keeps the
 * generated announcement within the 280-character display window: the post URL
 * must stay visible in the collapsed feed, so references come before the
 * excerpt. The text is editable in the CMS and validated against the same
 * limit before a signature is requested.
 */

import { buildQappIdentifier } from './ids.js';

export const QUITTER_APP_NAME = 'quitter';
export const QUITTER_PUBLIC_SALT = '6hMqDBxky6j1G2wZEHgIiOeApj3x3CP8LQwg0Ok0RVc=';
export const QUITTER_POST_ENTITY = 'POST';
export const QUITTER_ROOT_ENTITY = 'ROOT';

/** `MAX_TEXT_LENGTH` in Quitter's Post component (collapsed feed view). */
export const QUITTER_TEXT_LIMIT = 280;

export const QUITTER_MAX_IMAGES = 2;

/** Deterministic Quitter post identifier for one CMS post. */
export async function quitterPostIdentifier(token) {
  return buildQappIdentifier({
    appName: QUITTER_APP_NAME,
    publicSalt: QUITTER_PUBLIC_SALT,
    entityType: QUITTER_POST_ENTITY,
    parentId: QUITTER_ROOT_ENTITY,
    uid: token
  });
}

function collapse(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateCharacters(value, max) {
  const source = collapse(value);
  if (max <= 0) return '';
  if (source.length <= max) return source;
  if (max === 1) return '…';
  return source.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Prefilled, owner-editable announcement text.
 *
 * Shape mirrors Subwire's own cross-post convention: a title line, the article
 * URL, then an optional excerpt. Everything after the URL is safe to truncate.
 */
export function buildQuitterAnnouncement({
  title = '',
  excerpt = '',
  postUrl = '',
  subwireUrl = '',
  limit = QUITTER_TEXT_LIMIT
} = {}) {
  const url = String(postUrl || '').trim();
  if (!url) throw new Error('The announcement needs a link to the published post.');
  const urls = [url];
  const extra = String(subwireUrl || '').trim();
  if (extra) urls.push(extra);
  const urlBlock = urls.join('\n');
  const max = Math.max(40, Number(limit) || QUITTER_TEXT_LIMIT);

  let heading = 'New publication: ' + collapse(title || 'Untitled post');
  const fixed = 2 + urlBlock.length + 2;
  let headingBudget = max - fixed;
  if (headingBudget < 12) {
    throw new Error('The post URL is too long for a Quitter announcement within ' + max + ' characters.');
  }
  if (heading.length > headingBudget) {
    heading = 'New publication: ' + truncateCharacters(title || 'Untitled post', Math.max(4, headingBudget - 'New publication: '.length));
  }

  const used = heading.length + fixed;
  let body = '';
  const remaining = max - used;
  if (remaining > 20) {
    const summary = collapse(excerpt);
    if (summary) body = '\n\n' + truncateCharacters(summary, remaining);
  }
  const text = heading + '\n\n' + urlBlock + body;
  return text.length <= max ? text : truncateCharacters(text, max);
}

/** Validate editable announcement text against Quitter's display window. */
export function quitterAnnouncementProblem(text, limit = QUITTER_TEXT_LIMIT) {
  const value = String(text || '').trim();
  if (!value) return 'The Quitter announcement text is empty.';
  if (value.length > limit) return 'The Quitter announcement is ' + value.length + ' characters; Quitter shows at most ' + limit + '. Shorten it.';
  return '';
}

/** Quitter's post payload. Only `text`, `timestamp` and `name` are used here. */
export function buildQuitterPost({ text, name, timestamp }) {
  return {
    text: String(text || '').trim(),
    timestamp: Number(timestamp) || Date.now(),
    name: String(name || '').trim()
  };
}

/** Fail-closed self-check mirroring what Quitter's Post component reads. */
export function isQuitterRenderablePost(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.text !== 'string' || !value.text.trim()) return false;
  if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return false;
  if (typeof value.name !== 'string' || !value.name.trim()) return false;
  if (value.images === undefined) return true;
  if (!Array.isArray(value.images) || value.images.length > QUITTER_MAX_IMAGES) return false;
  return value.images.every((image) => image && typeof image.src === 'string' && image.src.length > 0);
}

/** Batch resource entry for one Quitter announcement. */
export function buildQuitterResource({ text, name, timestamp, identifier }) {
  const document = buildQuitterPost({ text, name, timestamp });
  if (!isQuitterRenderablePost(document)) throw new Error('The generated Quitter announcement is not valid.');
  return {
    stage: 'quitter',
    service: 'DOCUMENT',
    identifier,
    document,
    filename: identifier + '.json',
    title: 'Quitter announcement for ' + name,
    description: 'Public Quitter announcement published from the Qortal Migration Studio CMS.'
  };
}
