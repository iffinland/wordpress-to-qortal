import { createPrivateKey, randomBytes } from 'node:crypto';
import { signRequest } from './auth.js';
import { BrokerError, BROKER_ERROR } from './errors.js';

const REFRESH_SCHEMA = 'qms-broker-refresh@1';

/**
 * Small agent-side client for the policy broker. It can only produce
 * authenticated publication requests; it has no wallet, signing or node
 * operation and holds no External Auth token.
 *
 * Every request is Ed25519-signed (method, path, body hash, timestamp, nonce)
 * and additionally carries a short-lived broker access grant. The grant is
 * renewed automatically through the signed /v1/auth/refresh route. A grant
 * failure is retried exactly once after a refresh; publication work is never
 * retried after an ambiguous transport or signing outcome.
 */
export class BrokerClient {
  constructor({
    baseUrl,
    keyId,
    privateKey,
    accessToken = null,
    accessExpiresAt = null,
    fetchImpl = globalThis.fetch,
    clock = () => Date.now()
  }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.keyId = keyId;
    this.privateKey = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
    this.accessToken = accessToken;
    this.accessExpiresAt = accessExpiresAt;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
  }

  signedHeaders(method, path, bodyBytes) {
    return signRequest({
      method,
      path,
      bodyBytes,
      keyId: this.keyId,
      privateKey: this.privateKey,
      timestamp: this.clock(),
      nonce: randomBytes(24).toString('base64url')
    });
  }

  async refreshAccess() {
    const path = '/v1/auth/refresh';
    const bodyBytes = Buffer.from(JSON.stringify({ schema: REFRESH_SCHEMA }), 'utf8');
    const headers = this.signedHeaders('POST', path, bodyBytes);
    headers['content-type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method: 'POST',
        headers,
        body: bodyBytes,
        signal: controller.signal,
        redirect: 'error'
      });
    } catch (error) {
      throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'The broker access refresh failed.', { cause: error.message });
    } finally {
      clearTimeout(timer);
    }
    const parsed = await this.parseResponse(response);
    if (!response.ok) {
      throw this.toError(parsed, response.status);
    }
    if (!parsed || typeof parsed.accessToken !== 'string' || !Number.isFinite(parsed.expiresAt)) {
      throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'The broker returned an invalid access grant.');
    }
    this.accessToken = parsed.accessToken;
    this.accessExpiresAt = parsed.expiresAt;
    return parsed;
  }

  async ensureAccess() {
    if (this.accessToken && Number.isFinite(this.accessExpiresAt) &&
        this.accessExpiresAt - this.clock() > 30000) {
      return this.accessToken;
    }
    await this.refreshAccess();
    return this.accessToken;
  }

  async parseResponse(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  toError(parsed, status) {
    const error = parsed?.error ?? {};
    return new BrokerError(error.code ?? BROKER_ERROR.UNAVAILABLE, error.message ?? 'The broker rejected the request.', {
      status,
      details: error.details ?? {}
    });
  }

  isGrantError(error) {
    return error instanceof BrokerError && [
      BROKER_ERROR.AUTH_GRANT_REQUIRED,
      BROKER_ERROR.AUTH_GRANT_INVALID,
      BROKER_ERROR.AUTH_GRANT_EXPIRED,
      BROKER_ERROR.AUTH_GRANT_REVOKED
    ].includes(error.code);
  }

  async request(method, path, body = null, { timeoutMs = 120000, retryGrant = true } = {}) {
    await this.ensureAccess();
    const bodyBytes = body === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = this.signedHeaders(method, path, bodyBytes);
    headers.authorization = 'Bearer ' + this.accessToken;
    if (body !== null) headers['content-type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers,
        body: body === null ? undefined : bodyBytes,
        signal: controller.signal,
        redirect: 'error'
      });
    } catch (error) {
      throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'The broker request failed.', { cause: error.message });
    } finally {
      clearTimeout(timer);
    }
    const parsed = await this.parseResponse(response);
    if (!response.ok) {
      const error = this.toError(parsed, response.status);
      if (retryGrant && this.isGrantError(error)) {
        this.accessToken = null;
        this.accessExpiresAt = null;
        return this.request(method, path, body, { timeoutMs, retryGrant: false });
      }
      throw error;
    }
    return parsed;
  }

  publish(body) {
    return this.request('POST', '/v1/publications', body);
  }

  getPublication(publicationId) {
    return this.request('GET', '/v1/publications/' + encodeURIComponent(publicationId));
  }

  verifyPublication(publicationId) {
    return this.request('POST', '/v1/publications/' + encodeURIComponent(publicationId) + '/verify');
  }
}
