/**
 * Structured source-adapter errors. The engine maps these to QmsError with the
 * same code, preserving retryability and safe details for UI/CLI consumers.
 */
export const SOURCE_ERROR_CODES = Object.freeze({
  INVALID_CONFIG: 'SOURCE_INVALID_CONFIG',
  INVALID_RESPONSE: 'SOURCE_INVALID_RESPONSE',
  AUTH_REQUIRED: 'SOURCE_AUTH_REQUIRED',
  AUTH_FAILED: 'SOURCE_AUTH_FAILED',
  UNSUPPORTED_AUTH: 'SOURCE_UNSUPPORTED_AUTH',
  CONNECTION_FAILED: 'SOURCE_CONNECTION_FAILED',
  TIMEOUT: 'SOURCE_TIMEOUT',
  NETWORK_ERROR: 'SOURCE_NETWORK_ERROR',
  RATE_LIMITED: 'SOURCE_RATE_LIMITED',
  HTTP_ERROR: 'SOURCE_HTTP_ERROR',
  NOT_FOUND: 'SOURCE_NOT_FOUND',
  UNSUPPORTED_CAPABILITY: 'SOURCE_UNSUPPORTED_CAPABILITY',
  CANCELLED: 'SOURCE_CANCELLED',
  ADAPTER_NOT_FOUND: 'SOURCE_ADAPTER_NOT_FOUND',
  ADAPTER_EXISTS: 'SOURCE_ADAPTER_EXISTS',
  CONTRACT_VIOLATION: 'SOURCE_CONTRACT_VIOLATION'
});

export class SourceError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'SourceError';
    this.code = code;
    this.details = options.details ?? {};
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.httpStatus = options.httpStatus ?? null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
      retryAfterMs: this.retryAfterMs,
      httpStatus: this.httpStatus
    };
  }
}

export function isSourceError(error) {
  return error instanceof SourceError;
}

export function cancelledError(message = 'Source operation was cancelled.') {
  return new SourceError(SOURCE_ERROR_CODES.CANCELLED, message, { retryable: true });
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw cancelledError();
  }
}

/** Map HTTP status to a safe, retry-aware source error. */
export function httpError(status, statusText, { body = '', url = null, retryAfterMs = null } = {}) {
  const safeMessage = `Source request failed with HTTP ${status}${statusText ? ` ${statusText}` : ''}.`;
  const details = { status, url, body: String(body ?? '').slice(0, 500) };
  if (status === 401) {
    return new SourceError(SOURCE_ERROR_CODES.AUTH_FAILED, 'Source authentication failed (HTTP 401).', {
      details, retryable: false, httpStatus: status
    });
  }
  if (status === 403) {
    return new SourceError(SOURCE_ERROR_CODES.AUTH_REQUIRED, 'Source denied access (HTTP 403).', {
      details, retryable: false, httpStatus: status
    });
  }
  if (status === 404) {
    return new SourceError(SOURCE_ERROR_CODES.NOT_FOUND, 'Source resource was not found (HTTP 404).', {
      details, retryable: false, httpStatus: status
    });
  }
  if (status === 408 || status === 504) {
    return new SourceError(SOURCE_ERROR_CODES.TIMEOUT, safeMessage, {
      details, retryable: true, httpStatus: status
    });
  }
  if (status === 429) {
    return new SourceError(SOURCE_ERROR_CODES.RATE_LIMITED, 'Source rate limit reached (HTTP 429).', {
      details, retryable: true, httpStatus: status, retryAfterMs
    });
  }
  if (status >= 500) {
    return new SourceError(SOURCE_ERROR_CODES.HTTP_ERROR, safeMessage, {
      details, retryable: true, httpStatus: status
    });
  }
  return new SourceError(SOURCE_ERROR_CODES.HTTP_ERROR, safeMessage, {
    details, retryable: false, httpStatus: status
  });
}
