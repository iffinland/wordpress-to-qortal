/**
 * First-class qortal:// link support.
 *
 * qortal:// is a navigation scheme, not a web URL. It is accepted only when
 * the service is one of the Qortal QDN services and the name segment is a
 * valid, percent-encoded QDN name. The original text is preserved byte for
 * byte so percent-encoded names such as `developer%20iffi` reach Hub intact.
 */

export const QORTAL_LINK_MAX_LENGTH = 2048;
export const QORTAL_ATTRIBUTION_LINK = 'qortal://WEBSITE/Qortal%20Web%20Builders/';

/** Qortal Core arbitrary-resource services that Hub can navigate to. */
export const QORTAL_SERVICES = Object.freeze([
  'WEBSITE', 'APP', 'DOCUMENT', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE', 'GAME', 'MULTI'
]);

const SERVICE_SET = new Set(QORTAL_SERVICES);
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;
const MALFORMED_PERCENT = /%(?![0-9A-Fa-f]{2})/;

/**
 * Parse and validate a qortal:// link without normalizing it.
 * Returns null for malformed, unsafe or unsupported links.
 */
export function parseQortalLink(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > QORTAL_LINK_MAX_LENGTH) return null;
  if (CONTROL_OR_SPACE.test(raw)) return null;
  if (MALFORMED_PERCENT.test(raw)) return null;

  const match = /^qortal:\/\/([A-Za-z][A-Za-z0-9]*)(?:\/([^?#]*))?(?:\?([^#]*))?(?:#(.*))?$/i.exec(raw);
  if (!match) return null;

  const service = match[1].toUpperCase();
  if (!SERVICE_SET.has(service)) return null;

  const rest = match[2] ?? '';
  const segments = rest.split('/');
  const encodedName = segments[0] ?? '';
  if (!encodedName) return null;

  let name;
  try {
    name = decodeURIComponent(encodedName.replace(/\+/g, ' ')).trim();
  } catch {
    return null;
  }
  if (!name) return null;

  return {
    raw,
    service,
    name,
    encodedName,
    path: segments.slice(1).join('/'),
    query: match[3] ?? '',
    hash: match[4] ?? ''
  };
}

export function isQortalLink(value) {
  return Boolean(parseQortalLink(value));
}

/** Used by the HTML sanitizer; returns the original href or an empty string. */
export function sanitizeQortalHref(value) {
  const parsed = parseQortalLink(value);
  return parsed ? parsed.raw : '';
}
