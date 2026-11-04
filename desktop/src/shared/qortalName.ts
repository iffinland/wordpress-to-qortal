/**
 * Desktop mirror of lib/engine/qortal-name.js. Keep these rules and test
 * vectors in sync; desktop/tests/validation.spec.ts and
 * test/phase5/name-rules.test.js assert parity.
 */
export const QORTAL_NAME_MIN_BYTES = 3;
export const QORTAL_NAME_MAX_BYTES = 40;
export const QORTAL_NAME_MIN_LENGTH = QORTAL_NAME_MIN_BYTES;
export const QORTAL_NAME_MAX_LENGTH = QORTAL_NAME_MAX_BYTES;
export const QORTAL_NAME_ZERO_WIDTH_PATTERN = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
export const QORTAL_NAME_CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F]/u;
export const QORTAL_NAME_UNPAIRED_SURROGATE_PATTERN = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
export const QORTAL_NAME_ADDRESS_LIKE_PATTERN = /^Q[1-9A-HJ-NP-Za-km-z]{33}$/;

export type QortalNameCheck =
  | { ok: true; name: string }
  | { ok: false; code: string; message: string };

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function normalizeQortalName(value: string): string {
  return String(value)
    .normalize('NFKC')
    .replace(QORTAL_NAME_ZERO_WIDTH_PATTERN, '')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim();
}

export function checkQortalName(value: unknown): QortalNameCheck {
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

export function isValidQortalName(value: unknown): value is string {
  return checkQortalName(value).ok === true;
}
