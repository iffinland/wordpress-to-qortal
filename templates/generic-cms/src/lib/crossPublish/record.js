/**
 * Cross-post record.
 *
 * One idempotent DOCUMENT per site remembers which destinations were published
 * for a CMS post, their QDN identifiers and timestamps. The record is a derived
 * interoperability artifact: a missing or invalid record is harmless and is
 * treated as empty, so an owner can always publish again. Quitter is only
 * created when neither the record nor the deterministic Quitter resource
 * already exists, which is what makes the announcement a first-publish action.
 */

export const CROSSPOST_RECORD_IDENTIFIER = 'qms-cms-crosspost';
export const CROSSPOST_RECORD_VERSION = 1;

export function emptyCrossPostRecord(siteId = '') {
  return { version: CROSSPOST_RECORD_VERSION, siteId: String(siteId || ''), posts: {} };
}

export function readCrossPostRecord(raw, siteId = '') {
  if (!raw || typeof raw !== 'object' || raw.version !== CROSSPOST_RECORD_VERSION
    || !raw.posts || typeof raw.posts !== 'object' || Array.isArray(raw.posts)) {
    return { ok: false, record: emptyCrossPostRecord(siteId), errors: ['The cross-post record is missing or invalid; it will be rebuilt.'] };
  }
  const posts = {};
  for (const [postId, entry] of Object.entries(raw.posts)) {
    if (!entry || typeof entry !== 'object') continue;
    posts[String(postId)] = {
      qtube: Array.isArray(entry.qtube) ? entry.qtube.filter((id) => typeof id === 'string') : [],
      subwire: typeof entry.subwire === 'string' ? entry.subwire : null,
      quitter: typeof entry.quitter === 'string' ? entry.quitter : null,
      updatedAt: Number(entry.updatedAt) || 0
    };
  }
  return { ok: true, record: { version: CROSSPOST_RECORD_VERSION, siteId: String(raw.siteId || siteId || ''), posts }, errors: [] };
}

export function crossPostEntry(record, postId) {
  const posts = record && record.posts ? record.posts : {};
  return posts[String(postId)] || null;
}

export function mergeCrossPostRecord(record, { postId, qtube = [], subwire = null, quitter = null, timestamp = Date.now() } = {}) {
  const base = record && record.version === CROSSPOST_RECORD_VERSION ? record : emptyCrossPostRecord();
  const previous = crossPostEntry(base, postId) || { qtube: [], subwire: null, quitter: null, updatedAt: 0 };
  const nextQtube = Array.from(new Set([...(previous.qtube || []), ...qtube.filter((id) => typeof id === 'string')]));
  return {
    ...base,
    version: CROSSPOST_RECORD_VERSION,
    posts: {
      ...base.posts,
      [String(postId)]: {
        qtube: nextQtube,
        subwire: subwire || previous.subwire || null,
        quitter: quitter || previous.quitter || null,
        updatedAt: Number(timestamp) || Date.now()
      }
    }
  };
}
