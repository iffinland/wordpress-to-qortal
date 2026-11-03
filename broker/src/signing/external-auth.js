import { BrokerError, BROKER_ERROR, fail } from '../errors.js';
import { sha256Hex } from '../util.js';
import { readTokenFile } from '../credentials/store.js';

const PUBLISH_PATH = '/qdn/publish';

const ERROR_CODE = /^[a-z][a-z0-9_]{2,63}$/;
const CORE_MESSAGE = /^[\x20-\x7e]{1,200}$/;
const PUBLISH_STAGES = new Set(['fee', 'upload', 'convert', 'process', 'wallet', 'request']);

/**
 * Stable Core rejection codes External Auth is allowed to report. Anything
 * outside this set is collapsed to CORE_REQUEST_REJECTED. The set mirrors
 * packages/auth-daemon/src/publishDiagnostics.ts in External Auth 0.2.0.
 */
const CORE_ERROR_CODES = new Set([
  'CORE_API_KEY_NOT_GENERATED',
  'CORE_API_KEY_MISSING',
  'CORE_API_KEY_INVALID',
  'CORE_NAME_NOT_REGISTERED',
  'CORE_BLOCKCHAIN_NEEDS_SYNC',
  'CORE_ADDRESS_UNKNOWN',
  'CORE_DATA_MISSING',
  'CORE_INVALID_SIGNATURE',
  'CORE_TRANSACTION_INVALID',
  'CORE_TRANSFORMATION_ERROR',
  'CORE_QUERY_PARAMETER_INVALID',
  'CORE_NO_TIME_SYNC',
  'CORE_REPOSITORY_ISSUE',
  'CORE_INVALID_DATA',
  'CORE_UNAUTHORIZED',
  'CORE_REQUEST_REJECTED',
  'CORE_HTTP_ERROR'
]);

const KNOWN_ERROR_CODES = new Map([
  ['unauthorized', 'UNAUTHORIZED'],
  ['approval_required', 'APPROVAL_REQUIRED'],
  ['wallet_locked', 'WALLET_LOCKED'],
  ['wallet_not_found', 'WALLET_NOT_FOUND'],
  ['publish_failed', 'PUBLISH_FAILED']
]);

/**
 * Collapse control characters and redact anything long enough to be a token,
 * signature, seed or payload blob. Mirrors the External Auth sanitizer so a
 * backend cannot widen the bound by returning more than it should.
 */
export function sanitizeCoreMessage(value) {
  if (typeof value !== 'string') return null;
  const collapsed = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!collapsed) return null;
  const bounded = collapsed.replace(/[A-Za-z0-9+/=_-]{48,}/g, '[redacted]').slice(0, 200);
  if (bounded === '[redacted]') return null;
  return CORE_MESSAGE.test(bounded) ? bounded : null;
}

/**
 * Convert an External Auth error body into a bounded, non-sensitive code.
 * Raw backend text can contain Core paths, names, request parameters or
 * echoed input, so it is classified rather than stored. A structured
 * diagnostic (External Auth 0.2.0 + Core diagnostics patch) wins over text
 * classification, and only allowlisted codes are accepted.
 */
export function classifyExternalAuthError(parsed) {
  const structured = parsed?.diagnostic?.coreErrorCode;
  if (typeof structured === 'string') {
    // A structured diagnostic is authoritative: never fall back to the
    // generic "publish_failed" token when External Auth reported a Core code.
    return CORE_ERROR_CODES.has(structured) ? structured : 'CORE_REQUEST_REJECTED';
  }
  const raw = typeof parsed?.error === 'string' ? parsed.error.trim() : '';
  if (!raw) return 'UNKNOWN';
  const known = KNOWN_ERROR_CODES.get(raw);
  if (known) return known;
  if (ERROR_CODE.test(raw)) return raw.toUpperCase();
  if (/^name not registered/i.test(raw)) return 'CORE_NAME_NOT_REGISTERED';
  if (/^data not supplied/i.test(raw)) return 'CORE_DATA_MISSING';
  if (/^request failed: \d+$/i.test(raw)) return 'CORE_HTTP_ERROR';
  return 'CORE_REQUEST_REJECTED';
}

function classificationForStatus(status) {
  if (status === 401 || status === 403) return 'AUTH';
  if (status >= 500) return 'BACKEND';
  return 'REQUEST';
}

function diagnosticFor(status, parsed) {
  const diagnostic = {
    httpStatus: status,
    errorClass: classificationForStatus(status),
    errorCode: classifyExternalAuthError(parsed)
  };
  const structured = parsed?.diagnostic;
  if (structured && typeof structured === 'object') {
    if (PUBLISH_STAGES.has(structured.stage)) diagnostic.stage = structured.stage;
    if (
      Number.isInteger(structured.coreStatus) &&
      structured.coreStatus >= 100 &&
      structured.coreStatus <= 599
    ) {
      diagnostic.coreStatus = structured.coreStatus;
    }
    const message = sanitizeCoreMessage(structured.coreMessage);
    if (message) diagnostic.coreMessage = message;
  }
  return diagnostic;
}

/**
 * Narrow client for Qortal External Auth. It deliberately exposes exactly one
 * operation: publish one DOCUMENT resource. It never calls /tx/sign,
 * /wallet/*, /node/proxy, /qortal/request or any admin route. The wallet id,
 * node URL and fee policy are fixed by the broker configuration, not by the
 * development agent.
 */
export class ExternalAuthSigningBackend {
  constructor({
    baseUrl,
    walletId,
    tokenFile,
    timeoutMs = 60000,
    expectedAddress,
    fetchImpl = globalThis.fetch,
    credentialStore = null
  }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.walletId = walletId;
    this.tokenFile = tokenFile;
    this.timeoutMs = timeoutMs;
    this.expectedAddress = expectedAddress;
    this.fetchImpl = fetchImpl;
    this.credentialStore = credentialStore;
    this.token = null;
  }

  async open() {
    if (this.credentialStore) {
      if (!this.credentialStore.token) await this.credentialStore.open();
    } else {
      this.token = readTokenFile(this.tokenFile);
    }
    return this;
  }

  /**
   * Read the current token on every publish. A validated SIGHUP/socket reload
   * therefore takes effect for the next transaction without restarting the
   * broker or touching state, budget reservations or the nonce cache.
   */
  currentToken() {
    if (this.credentialStore) return this.credentialStore.current();
    if (!this.token) throw new BrokerError(BROKER_ERROR.UNAVAILABLE, 'The signing backend is not initialized.');
    return this.token;
  }

  async publish({ service, name, identifier, dataBase64, feeAtomic }) {
    if (service !== 'DOCUMENT') {
      fail(BROKER_ERROR.POLICY_SERVICE, 'The signing backend only accepts DOCUMENT resources.');
    }
    const token = this.currentToken();
    // External Auth 0.2.0 forwards "fee" verbatim to Core's
    // "/arbitrary/...?fee=" query parameter, where it binds to a Java Long in
    // atomic units (100000000 = 1 QORT). A QORT decimal such as 0.01 fails
    // Core parameter binding before the name is validated.
    if (!Number.isSafeInteger(feeAtomic) || feeAtomic <= 0) {
      fail(BROKER_ERROR.FEE_INVALID, 'The signing backend requires a positive safe-integer atomic per-resource fee.');
    }
    const body = JSON.stringify({
      walletId: this.walletId,
      data: dataBase64,
      service,
      registeredName: name,
      identifier,
      fee: feeAtomic
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(this.baseUrl + PUBLISH_PATH, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + token
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
    const diagnostic = response.ok ? null : diagnosticFor(response.status, parsed);
    if (response.status === 401 || response.status === 403) {
      return {
        state: 'rejected',
        code: parsed?.error === 'approval_required' ? 'SIGNING_APPROVAL_REQUIRED' : 'SIGNING_REJECTED',
        message: 'The signing backend rejected the publication request.',
        diagnostic,
        evidence: { status: response.status, errorCode: diagnostic.errorCode }
      };
    }
    if (response.status >= 500) {
      return {
        state: 'ambiguous',
        code: 'SIGNING_BACKEND_UNAVAILABLE',
        message: 'The signing backend failed after receiving the request; the outcome is unknown.',
        diagnostic,
        evidence: { status: response.status, errorCode: diagnostic.errorCode }
      };
    }
    if (!response.ok) {
      return {
        state: 'failed',
        code: 'SIGNING_FAILED',
        message: 'The signing backend refused the publication request.',
        diagnostic,
        evidence: { status: response.status, errorCode: diagnostic.errorCode }
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
