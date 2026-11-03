/**
 * Qortal Core name rules, modelled from Qortal Core.
 *
 * Core registers a name when all of the following hold:
 *  - its UTF-8 encoded length is between 3 and 40 bytes (Name.MIN_NAME_SIZE /
 *    Name.MAX_NAME_SIZE, RegisterNameTransaction.isValid());
 *  - it is already in Core's display-normalized form: Unicode NFKC, no
 *    zero-width characters, no leading/trailing whitespace and no repeated or
 *    non-space whitespace (Unicode.normalize());
 *  - it is not a valid Qortal address (Crypto.isValidAddress()).
 *
 * Core deliberately has no ASCII character whitelist. Internal spaces and
 * non-ASCII letters are valid. The exact registered string is the display
 * identity. Core's reducedName (Unicode.sanitize: NFKD, marks/Other removed,
 * lowercased, homoglyph-reduced) is only a uniqueness/search key; it must never
 * be used as an identity, ownership or handoff name.
 *
 * This module adds three defensive checks that are stricter than Core:
 * control characters, unpaired UTF-16 surrogates and address-shaped names.
 * They cannot appear in legitimate Qortal display names and are rejected so a
 * hostile or corrupted manifest cannot smuggle invisible/control text into a
 * URL, log or receipt.
 */
export const QORTAL_NAME_MIN_BYTES = 3;
export const QORTAL_NAME_MAX_BYTES = 40;
// Backwards-compatible aliases. The value is now the UTF-8 byte limit, not a
// JavaScript string length limit.
export const QORTAL_NAME_MIN_LENGTH = QORTAL_NAME_MIN_BYTES;
export const QORTAL_NAME_MAX_LENGTH = QORTAL_NAME_MAX_BYTES;

export const QORTAL_NAME_ZERO_WIDTH_PATTERN = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
export const QORTAL_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
export const QORTAL_NAME_UNPAIRED_SURROGATE_PATTERN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
// Qortal addresses encode a 25-byte value (version 58 + 20-byte hash + 4-byte
// checksum) and are normally 34 base58 characters. This is a conservative
// lookalike guard, not a checksum implementation.
export const QORTAL_NAME_ADDRESS_LIKE_PATTERN = /^Q[1-9A-HJ-NP-Za-km-z]{33}$/;

/** UTF-8 byte length, matching com.google.common.base.Utf8.encodedLength. */
export function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}

/** Core's Unicode.normalize(): NFKC, zero-width removal, whitespace trim/collapse. */
export function normalizeQortalName(value) {
  return String(value)
    .normalize('NFKC')
    .replace(QORTAL_NAME_ZERO_WIDTH_PATTERN, '')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim();
}

/**
 * Check a display name against the Core rules. Returns the exact input string
 * on success; it never trims or otherwise rewrites the caller's name.
 */
export function checkQortalName(value) {
  if (typeof value !== 'string') {
    return { ok: false, code: 'TARGET_NAME_REQUIRED', message: 'A target Qortal name is required.' };
  }
  const normalized = normalizeQortalName(value);
  if (normalized === '') {
    return { ok: false, code: 'TARGET_NAME_REQUIRED', message: 'A target Qortal name is required.' };
  }
  if (value !== normalized) {
    return {
      ok: false,
      code: 'TARGET_NAME_NOT_NORMALIZED',
      message: 'Qortal names must use Unicode NFKC, single internal spaces, and no leading or trailing whitespace.'
    };
  }
  if (QORTAL_NAME_CONTROL_PATTERN.test(value)) {
    return { ok: false, code: 'TARGET_NAME_CONTROL', message: 'Qortal names must not contain control characters.' };
  }
  if (QORTAL_NAME_UNPAIRED_SURROGATE_PATTERN.test(value)) {
    return { ok: false, code: 'TARGET_NAME_UNPAIRED_SURROGATE', message: 'Qortal names must contain valid Unicode text.' };
  }
  const bytes = utf8ByteLength(value);
  if (bytes < QORTAL_NAME_MIN_BYTES || bytes > QORTAL_NAME_MAX_BYTES) {
    return {
      ok: false,
      code: 'TARGET_NAME_BYTE_LENGTH',
      message: 'Qortal names must be ' + QORTAL_NAME_MIN_BYTES + '-' + QORTAL_NAME_MAX_BYTES + ' UTF-8 bytes.'
    };
  }
  if (QORTAL_NAME_ADDRESS_LIKE_PATTERN.test(value)) {
    return { ok: false, code: 'TARGET_NAME_ADDRESS', message: 'Qortal names must not be a Qortal address.' };
  }
  return { ok: true, name: value };
}

export function isValidQortalName(value) {
  return checkQortalName(value).ok === true;
}
