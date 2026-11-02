/**
 * Typed errors for the Qortal Migration Studio engine.
 * Codes are stable and safe to show in a UI or log.
 */
export const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_PROJECT_ID: 'INVALID_PROJECT_ID',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_EXISTS: 'PROJECT_EXISTS',
  PROJECT_ARCHIVED: 'PROJECT_ARCHIVED',
  PROJECT_SCHEMA_UNSUPPORTED: 'PROJECT_SCHEMA_UNSUPPORTED',
  PROJECT_LOCKED: 'PROJECT_LOCKED',
  PROJECT_LOCK_STALE: 'PROJECT_LOCK_STALE',
  PROJECT_LOCK_CORRUPT: 'PROJECT_LOCK_CORRUPT',
  LOCK_LOST: 'LOCK_LOST',
  LOCK_RELEASE_DENIED: 'LOCK_RELEASE_DENIED',
  STATE_VERSION_UNSUPPORTED: 'STATE_VERSION_UNSUPPORTED',
  STATE_JOURNAL_CORRUPT: 'STATE_JOURNAL_CORRUPT',
  STATE_NOT_OPEN: 'STATE_NOT_OPEN',
  PATH_ESCAPE: 'PATH_ESCAPE',
  OPERATION_CANCELLED: 'OPERATION_CANCELLED',
  OPERATION_NOT_FOUND: 'OPERATION_NOT_FOUND',
  OPERATION_NOT_CANCELLABLE: 'OPERATION_NOT_CANCELLABLE',
  INVALID_EVENT: 'INVALID_EVENT',
  HOST_PROTOCOL_ERROR: 'HOST_PROTOCOL_ERROR',
  UNKNOWN_METHOD: 'UNKNOWN_METHOD'
});

export class QmsError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'QmsError';
    this.code = code;
    this.details = options.details ?? {};
    this.retryable = options.retryable ?? false;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable
    };
  }
}

export function isQmsError(error) {
  return error instanceof QmsError;
}

export function asQmsError(error, fallbackCode = ERROR_CODES.INVALID_ARGUMENT) {
  if (error instanceof QmsError) {
    return error;
  }
  return new QmsError(fallbackCode, error instanceof Error ? error.message : String(error), {
    cause: error
  });
}

export function assert(condition, code, message, details) {
  if (!condition) {
    throw new QmsError(code, message, { details });
  }
}
