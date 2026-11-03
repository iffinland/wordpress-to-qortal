import { createPrivateKey, randomBytes } from 'node:crypto';
import { signRequest } from './auth.js';
import { BrokerError, BROKER_ERROR } from './errors.js';

/**
 * Agent-side client for the policy broker. It can only produce directly
 * signed publication requests; it has no wallet, signing or node operation and
 * holds no External Auth token.
 *
 * Every request is Ed25519-signed over method, path, body hash, timestamp and
 * nonce. There is no session, access grant, refresh loop or background timer:
 * the persistent key authenticates until the operator revokes it. Publication
 * work is never retried automatically after an ambiguous outcome.
 */
export class BrokerClient {
  constructor({
    baseUrl,
    keyId,
    privateKey,
    fetchImpl = globalThis.fetch,
    clock = () => Date.now()
  }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.keyId = keyId;
    this.privateKey = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
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

  async request(method, path, body = null, { timeoutMs = 120000 } = {}) {
    const bodyBytes = body === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = this.signedHeaders(method, path, bodyBytes);
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
      throw this.toError(parsed, response.status);
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
