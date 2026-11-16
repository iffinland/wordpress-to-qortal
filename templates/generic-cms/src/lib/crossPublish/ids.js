/**
 * Cross-app identifier math.
 *
 * Several current Qortal Q-Apps are built on `qapp-core` and derive their QDN
 * identifiers from a public app name, a per-app public salt and an
 * entity/parent pair:
 *
 *   saltedWord = publicSalt + word                (UTF-8)
 *   digest     = SHA-256(saltedWord)              (bytes)
 *   base64     = standard base64 of the digest
 *   safeBase64 = base64 with '+' -> '.', '/' -> '~', '_' -> '!' and padding removed
 *   hash       = safeBase64.slice(0, collisionStrength)
 *
 * An identifier is `<appHash>-<entityHash>-<parentHash>-<uid>-v1`; the search
 * prefix that the app passes with `prefix: true` is the same string without the
 * uid and version. These values are pinned to the verified upstream revisions:
 *
 *   - Subwire master a933a6c (SUBWIRE_ARTICLE under SUBWIRE_ROOT)
 *   - Quitter master 4e4246c (POST under ROOT)
 *   - qapp-core IDENTIFIER_BUILDER_VERSION = 'v1'
 *
 * This module is pure data math: it never calls the Qortal bridge and never
 * imports another application. It is the only place that knows the derivation,
 * so an upstream change is a single-file fix.
 */

/** `EnumCollisionStrength` in qapp-core. */
export const QAPP_COLLISION = Object.freeze({
  HIGH: 14,
  ENTITY_LABEL: 6,
  PARENT_REF: 14
});

/** `IDENTIFIER_BUILDER_VERSION` in the pinned qapp-core revision. */
export const QAPP_IDENTIFIER_VERSION = 'v1';

/** Length of the deterministic uid this CMS substitutes for qapp-core's random id. */
export const QAPP_UID_LENGTH = 12;

function safeBase64(base64) {
  return base64.replace(/\+/g, '.').replace(/\//g, '~').replace(/_/g, '!').replace(/=+$/, '');
}

function base64FromBytes(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

async function sha256(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error('SHA-256 is unavailable, so a cross-app identifier cannot be derived.');
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Uint8Array(await subtle.digest('SHA-256', body));
}

/** Lowercase hex SHA-256 of UTF-8 text (used for deterministic uid tokens). */
export async function sha256HexText(text) {
  const digest = await sha256(new TextEncoder().encode(String(text)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * A deterministic, URL-safe uid token. The same site/post/purpose always yields
 * the same token, so a retry targets the same QDN coordinate instead of
 * creating a second publication.
 */
export async function stableToken(seed, length = QAPP_UID_LENGTH) {
  const hex = await sha256HexText(seed);
  return hex.slice(0, Math.max(6, Math.min(64, length)));
}

/** Sans-io `hashWord`. */
export async function qappHashWord(word, collisionStrength, publicSalt) {
  const digest = await sha256(new TextEncoder().encode(String(publicSalt) + String(word)));
  return safeBase64(base64FromBytes(digest)).slice(0, collisionStrength);
}

async function appHash(appName, publicSalt) {
  return qappHashWord(appName, QAPP_COLLISION.HIGH, publicSalt);
}

async function entityHash(entityType, publicSalt) {
  return qappHashWord(entityType, QAPP_COLLISION.ENTITY_LABEL, publicSalt);
}

async function parentRefHash(parentId, publicSalt) {
  return qappHashWord(parentId, QAPP_COLLISION.PARENT_REF, publicSalt);
}

/** Mirrors qapp-core `buildIdentifier(entityType, parentId, false)` with a supplied uid. */
export async function buildQappIdentifier({ appName, publicSalt, entityType, parentId, uid }) {
  const app = await appHash(appName, publicSalt);
  const entity = await entityHash(entityType, publicSalt);
  const parent = parentId === null || parentId === undefined
    ? '0'.repeat(QAPP_COLLISION.PARENT_REF)
    : await parentRefHash(parentId, publicSalt);
  return app + '-' + entity + '-' + parent + '-' + uid + '-' + QAPP_IDENTIFIER_VERSION;
}

/** Mirrors qapp-core `buildSearchPrefix`; this is what the other app searches for. */
export async function buildQappSearchPrefix({ appName, publicSalt, entityType, parentId }) {
  const app = await appHash(appName, publicSalt);
  const entity = await entityHash(entityType, publicSalt);
  const parent = parentId === null || parentId === undefined
    ? '0'.repeat(QAPP_COLLISION.PARENT_REF)
    : await parentRefHash(parentId, publicSalt);
  return app + '-' + entity + '-' + parent + '-';
}

/** Recover the uid of an identifier built by this module. */
export function parseQappIdentifier(identifier, prefix, expectedLength = QAPP_UID_LENGTH) {
  if (typeof identifier !== 'string') return null;
  if (!identifier.startsWith(prefix)) return null;
  if (!identifier.endsWith('-' + QAPP_IDENTIFIER_VERSION)) return null;
  const uid = identifier.slice(prefix.length, identifier.length - QAPP_IDENTIFIER_VERSION.length - 1);
  return uid.length === expectedLength ? uid : null;
}
