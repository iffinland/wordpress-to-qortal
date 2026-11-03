import { readFileSync, statSync } from 'node:fs';
import { BrokerError, BROKER_ERROR, fail } from '../errors.js';
import { sha256Hex } from '../util.js';

const PUBLISH_PATH = '/qdn/publish';

function assertTokenFile(file) {
  let info;
  try {
    info = statSync(file);
  } catch (error) {
    fail(BROKER_ERROR.UNAVAILABLE, 'Unable to stat the External Auth token file.', { cause: error.message });
  }
  if (!info.isFile()) fail(BROKER_ERROR.UNAVAILABLE, 'The External Auth token path is not a regular file.');
  if ((info.mode & 0o077) !== 0) {
    fail(BROKER_ERROR.UNAVAILABLE, 'The External Auth token file must not be readable by group or other users.');
  }
  let token;
  try {
    token = readFileSync(file, 'utf8').trim();
  } catch (error) {
    fail(BROKER_ERROR.UNAVAILABLE, 'Unable to read the External Auth token file.', { cause: error.message });
  }
  if (!/^[A-Za-z0-9._~+\/-]{20,4096}$/.test(token)) {
    fail(BROKER_ERROR.UNAVAILABLE, 'The External Auth token file does not contain a plausible bearer token.');
  }
  return token;
}

/**
 * Narrow client for Qortal External Auth. It deliberately exposes exactly one
 * operation: publish one DOCUMENT resource. It never calls /tx/sign,
 * /wallet/*, /node/proxy, /qortal/request or any admin route. The wallet id,
 * node URL and fee policy are fixed by the broker configuration, not by the
 * development agent.
 */
export class ExternalAuthSigningBackend {
  constructor({ baseUrl, walletId, tokenFile, timeoutMs = 60000, expectedAddress, fetchImpl = globalThis.fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.walletId = walletId;
    this.tokenFile = tokenFile;
    this.timeoutMs = timeoutMs;
    this.expectedAddress = expectedAddress;
    this.fetchImpl = fetchImpl;
    this.token = null;
  }

  async open() {
    this.token = assertTokenFile(this.tokenFile);
    return this;
  }

  async publish({ service, name, identifier, dataBase64, feePerTransaction }) {
    if (service !== 'DOCUMENT') {
      fail(BROKER_ERROR.POLICY_SERVICE, 'The signing backend only accepts DOCUMENT resources.');
    }
    if (!this.token) throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'The signing backend is not initialized.');
    const body = JSON.stringify({
      walletId: this.walletId,
      data: dataBase64,
      service,
      registeredName: name,
      identifier,
      fee: feePerTransaction
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.baseUrl + PUBLISH_PATH, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + this.token
        },
        body,
        signal: controller.signal,
        redirect: 'error'
      });
    } catch (error) {
      return {
        state: 'ambiguous',
        code: 'SIGNING_TRANSPORT_UNKNOWN',
        message: 'The signing request outcome is unknown; the transaction is not retried.',
        evidence: { requestHash: sha256Hex(Buffer.from(body, 'utf8')) }
      };
    } finally {
      clearTimeout(timer);
    }

    let parsed = null;
    let text = '';
    try {
      text = await response.text();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (response.status === 401 || response.status === 403) {
      return {
        state: 'rejected',
        code: parsed?.error === 'approval_required' ? 'SIGNING_APPROVAL_REQUIRED' : 'SIGNING_REJECTED',
        message: 'The signing backend rejected the publication request.',
        evidence: { status: response.status, error: parsed?.error ?? null }
      };
    }
    if (response.status >= 500) {
      return {
        state: 'ambiguous',
        code: 'SIGNING_BACKEND_UNAVAILABLE',
        message: 'The signing backend failed after receiving the request; the outcome is unknown.',
        evidence: { status: response.status }
      };
    }
    if (!response.ok) {
      return {
        state: 'failed',
        code: 'SIGNING_FAILED',
        message: 'The signing backend refused the publication request.',
        evidence: { status: response.status, error: parsed?.error ?? null }
      };
    }
    const result = parsed && typeof parsed === 'object' && parsed.result ? parsed.result : parsed;
    const signature = result && typeof result.signature === 'string' ? result.signature : null;
    const address = result && typeof result.creatorAddress === 'string' ? result.creatorAddress : null;
    if (!signature) {
      return {
        state: 'ambiguous',
        code: 'SIGNING_RECEIPT_MISSING',
        message: 'The signing backend returned no transaction signature; the outcome is unknown.'
      };
    }
    if (!address) {
      return {
        state: 'ambiguous',
        code: 'SIGNER_UNVERIFIED',
        message: 'The signing backend did not report the creator address; the outcome is not trusted.'
      };
    }
    if (address !== this.expectedAddress) {
      return {
        state: 'ambiguous',
        code: 'SIGNER_MISMATCH',
        message: 'The signing backend reported a different creator address.',
        evidence: { expectedAddress: this.expectedAddress, reportedAddress: address }
      };
    }
    return {
      state: 'signed',
      signature,
      address: address ?? this.expectedAddress,
      message: 'The signing backend accepted the publication.'
    };
  }
}
