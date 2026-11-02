import dns from 'node:dns/promises';
import { QmsError, ERROR_CODES } from '../engine/errors.js';

/**
 * Media URL policy. Secure defaults:
 * - only http/https, never file:, data: or javascript:;
 * - no URL credentials;
 * - loopback, private, link-local and cloud-metadata targets are blocked;
 * - external media is linked-only unless explicitly enabled;
 * - redirects are validated one by one and HTTPS may not downgrade to HTTP.
 *
 * This is an application-level policy, not a substitute for OS-level egress
 * controls. DNS answers are checked, but a determined DNS-rebinding server can
 * still change answers between checks; Phase 5 must keep read-back verification.
 */
const MAX_URL_LENGTH = 4096;
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'metadata',
  'metadata.google.internal'
]);
const UNSAFE_SCHEMES = new Set(['file:', 'data:', 'javascript:', 'blob:', 'ftp:', 'gopher:', 'mailto:', 'tel:']);

function isIpv4(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function parseIpv4(value) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function ipv4IsPrivate(value) {
  const parts = parseIpv4(value);
  if (!parts) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isLoopbackAddress(value) {
  const normalized = String(value).toLowerCase();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  const parts = parseIpv4(normalized);
  return Boolean(parts && parts[0] === 127);
}

function ipv6IsPrivate(value) {
  const normalized = String(value).toLowerCase().split('%')[0];
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  if (/^fe[89ab]/.test(normalized)) return true; // link-local
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (isIpv4(mapped)) return ipv4IsPrivate(mapped);
  }
  return false;
}

function looksLikeIp(value) {
  return isIpv4(value) || value.includes(':');
}

export function parseMediaUrl(raw, { baseUrl = null } = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, code: ERROR_CODES.MEDIA_URL_INVALID, message: 'Media URL is empty.' };
  }
  const trimmed = raw.trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, code: ERROR_CODES.MEDIA_URL_INVALID, message: 'Media URL is too long.' };
  }
  let url;
  try {
    url = new URL(trimmed, baseUrl ?? undefined);
  } catch {
    return { ok: false, code: ERROR_CODES.MEDIA_URL_INVALID, message: 'Media URL is not a valid absolute URL.' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return {
      ok: false,
      code: ERROR_CODES.MEDIA_URL_INVALID,
      skipped: UNSAFE_SCHEMES.has(url.protocol),
      message: 'Unsupported media URL scheme: ' + url.protocol
    };
  }
  if (url.username || url.password) {
    return { ok: false, code: ERROR_CODES.MEDIA_URL_BLOCKED, message: 'Media URL must not contain credentials.' };
  }
  return { ok: true, url };
}

export async function validateMediaUrl(raw, {
  baseUrl = null,
  allowExternalMedia = false,
  allowLoopback = false,
  resolveDns = true,
  dnsLookup = (hostname, options) => dns.lookup(hostname, options)
} = {}) {
  const parsed = parseMediaUrl(raw, { baseUrl });
  if (!parsed.ok) return parsed;
  const url = parsed.url;

  let baseOrigin = null;
  if (baseUrl) {
    try {
      baseOrigin = new URL(baseUrl).origin;
    } catch {
      baseOrigin = null;
    }
  }
  const external = baseOrigin ? url.origin !== baseOrigin : false;
  if (external && !allowExternalMedia) {
    return {
      ok: false,
      external: true,
      policy: 'linked-only',
      code: ERROR_CODES.MEDIA_URL_BLOCKED,
      message: 'External media is linked-only unless external downloads are explicitly enabled.',
      url: url.toString()
    };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    if (!allowLoopback) {
      return {
        ok: false,
        external,
        policy: 'blocked-host',
        code: ERROR_CODES.MEDIA_URL_BLOCKED,
        message: 'Media URL host is not allowed: ' + hostname,
        url: url.toString()
      };
    }
  }

  const literal = looksLikeIp(hostname);
  if (literal) {
    const loopback = isLoopbackAddress(hostname);
    const privateAddress = loopback || (isIpv4(hostname) ? ipv4IsPrivate(hostname) : ipv6IsPrivate(hostname));
    if (privateAddress && !(allowLoopback && loopback)) {
      return {
        ok: false,
        external,
        policy: 'private-address',
        code: ERROR_CODES.MEDIA_URL_BLOCKED,
        message: 'Media URL resolves to a private, loopback or link-local address.',
        url: url.toString()
      };
    }
  } else if (resolveDns) {
    try {
      const answers = await dnsLookup(hostname, { all: true, verbatim: true });
      const addresses = Array.isArray(answers) ? answers : [answers];
      for (const answer of addresses) {
        const address = String(answer?.address ?? '');
        const loopback = isLoopbackAddress(address);
        const privateAddress = loopback || (isIpv4(address) ? ipv4IsPrivate(address) : ipv6IsPrivate(address));
        if (privateAddress && !(allowLoopback && loopback)) {
          return {
            ok: false,
            external,
            policy: 'private-address',
            code: ERROR_CODES.MEDIA_URL_BLOCKED,
            message: 'Media URL resolves to a private, loopback or link-local address.',
            details: { address },
            url: url.toString()
          };
        }
      }
    } catch (error) {
      return {
        ok: false,
        external,
        policy: 'dns-failed',
        code: ERROR_CODES.MEDIA_URL_BLOCKED,
        message: 'Media URL hostname could not be resolved safely.',
        details: { cause: error.message },
        url: url.toString()
      };
    }
  }

  return { ok: true, url, external, policy: 'allowed' };
}

export async function assertMediaUrl(raw, options) {
  const result = await validateMediaUrl(raw, options);
  if (!result.ok) {
    throw new QmsError(result.code ?? ERROR_CODES.MEDIA_URL_BLOCKED, result.message, {
      details: { url: raw, policy: result.policy ?? null },
      retryable: false
    });
  }
  return result;
}

/**
 * Validate a redirect target. HTTPS -> HTTP downgrade is refused; every other
 * target goes through the same private-address and external-media policy.
 */
export async function validateRedirect(previousUrl, location, options) {
  const previous = parseMediaUrl(previousUrl, {});
  const next = parseMediaUrl(location, { baseUrl: previousUrl });
  if (!next.ok) {
    return { ok: false, code: ERROR_CODES.MEDIA_REDIRECT_BLOCKED, message: next.message };
  }
  if (previous.ok && previous.url.protocol === 'https:' && next.url.protocol === 'http:') {
    return {
      ok: false,
      code: ERROR_CODES.MEDIA_REDIRECT_BLOCKED,
      message: 'Refusing an HTTPS to HTTP redirect for media.'
    };
  }
  const result = await validateMediaUrl(next.url.toString(), options);
  if (!result.ok) {
    return {
      ...result,
      code: ERROR_CODES.MEDIA_REDIRECT_BLOCKED,
      message: 'Redirect target blocked: ' + result.message
    };
  }
  return result;
}

export function isSameSite(urlValue, baseUrl) {
  try {
    return new URL(urlValue).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
