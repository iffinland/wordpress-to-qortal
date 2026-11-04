import { createHash, timingSafeEqual } from 'node:crypto';
import { BrokerError, BROKER_ERROR, fail } from './errors.js';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256Bytes(data) {
  return 'sha256:' + sha256Hex(data);
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

export function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(BROKER_ERROR.INVALID_REQUEST, label + ' must be an object.');
  }
  return value;
}

export function assertExactKeys(value, allowed, label) {
  assertObject(value, label);
  const allow = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allow.has(key));
  if (unknown.length > 0) {
    fail(BROKER_ERROR.INVALID_REQUEST, label + ' contains unsupported field(s): ' + unknown.join(', '));
  }
  return value;
}

export function assertString(value, label, { pattern = null, min = 1, max = 500 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail(BROKER_ERROR.INVALID_REQUEST, label + ' must be a string between ' + min + ' and ' + max + ' characters.');
  }
  if (pattern && !pattern.test(value)) {
    fail(BROKER_ERROR.INVALID_REQUEST, label + ' has an invalid format.');
  }
  return value;
}

export function assertInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(BROKER_ERROR.INVALID_REQUEST, label + ' must be an integer between ' + min + ' and ' + max + '.');
  }
  return value;
}

export function isSha256(value) {
  return typeof value === 'string' && SHA256.test(value);
}

/**
 * Strict canonical base64 decoding. Buffer.from is too lenient, so the input
 * must be canonical base64 and must round-trip byte-for-byte.
 */
export function decodeBase64Strict(value, label = 'dataBase64', maxBytes = Infinity) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(BROKER_ERROR.INVALID_REQUEST, label + ' must be a non-empty base64 string.');
  }
  if (value.length % 4 !== 0 || !BASE64.test(value)) {
    fail(BROKER_ERROR.INVALID_REQUEST, label + ' is not canonical base64.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    fail(BROKER_ERROR.INVALID_REQUEST, label + ' is not canonical base64.');
  }
  if (bytes.length > maxBytes) {
    fail(BROKER_ERROR.PAYLOAD_TOO_LARGE, label + ' exceeds the configured payload limit.');
  }
  return bytes;
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Remove sensitive keys and bound string length before anything reaches the
 * audit log. Request payload bytes and signatures are never logged.
 */
const SECRET_KEY = /(password|passwd|secret|token|apikey|api_key|seed|private|wallet|authorization|cookie|mnemonic|signature|dataBase64|unsignedBytes)/i;
export function redactForAudit(value, depth = 0) {
  if (depth > 6) return '[depth-limited]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactForAudit(item, depth + 1));
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 300) return value.slice(0, 300) + '…';
    return value;
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = redactForAudit(child, depth + 1);
    }
  }
  return out;
}

export function errorResponse(error) {
  const brokerError = error instanceof BrokerError ? error : new BrokerError(BROKER_ERROR.INTERNAL, 'Internal broker error.');
  return { status: brokerError.status, body: { error: brokerError.toJSON() } };
}
