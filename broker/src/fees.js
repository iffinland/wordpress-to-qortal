import { BROKER_ERROR, fail } from './errors.js';
import { qortToAtomic } from './amounts.js';

/**
 * Qortal Core ARBITRARY fee oracle.
 *
 * Core computes the recommended fee as:
 *   unitFee(timestamp) * ceil(serializedTransactionBytes / maxBytesPerUnitFee)
 * (Transaction.calcRecommendedFee, Blockchain.maxBytesPerUnitFee = 1024 in
 * the current mainnet blockchain config.)
 *
 * The serialized length is not derived from the QDN payload alone: for normal
 * off-chain resources the transaction stores a 32-byte data hash, the QDN
 * metadata hash and fixed transaction fields. This module reconstructs the
 * exact unsigned v5 ARBITRARY transaction shape for the resource and asks the
 * node's read-only POST /transactions/fee endpoint for the authoritative fee.
 * The unit fee is fetched separately and the quote must be an exact multiple of
 * it; any mismatch or unavailable endpoint fails closed.
 */

const TX_TYPE_ARBITRARY = 10;
const SERVICE_DOCUMENT = 800;
const METHOD_PUT = 0;
const COMPRESSION_NONE = 0;
const COMPRESSION_ZIP = 1;
const DATA_TYPE_RAW = 1;
const DATA_TYPE_HASH = 0;
const MAX_BYTES_PER_UNIT_FEE = 1024;
const MAX_DATA_SIZE = 256;
const MAX_ONCHAIN_FILE_SIZE = 224; // Core uses AES.getEncryptedFileSize(size) <= 256
const DEFAULT_TIMEOUT_MS = 10000;

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer) {
  if (buffer.length === 0) return '';
  let value = 0n;
  for (const byte of buffer) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value /= 58n;
    encoded = ALPHABET[remainder] + encoded;
  }
  for (let i = 0; i < buffer.length && buffer[i] === 0; i += 1) encoded = '1' + encoded;
  return encoded;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function int64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(value), 0);
  return buffer;
}

function sizedString(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([uint32(bytes.length), bytes]);
}

function zeroes(length) {
  return Buffer.alloc(length);
}

/**
 * Core's arbitrary transaction length for the resource. Kept exported so the
 * expected fee can be cross-checked against the node quote.
 */
export function arbitraryTransactionLength({ name, identifier, payloadBytes, metadataHashBytes = 32, secretBytes = 0 }) {
  const onChain = payloadBytes > 0 && payloadBytes <= MAX_ONCHAIN_FILE_SIZE;
  const dataBytes = onChain ? payloadBytes : 32;
  const metadata = onChain ? 0 : metadataHashBytes;
  const base = 4 + 8 + 4 + 64 + 32 + 8 + 64;
  const extras = 4 + 1 + 4;
  const extrasV5 = 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4;
  return base + extras + extrasV5 + Buffer.byteLength(name, 'utf8') + Buffer.byteLength(identifier, 'utf8') +
    secretBytes + dataBytes + metadata + 4;
}

export function buildUnsignedArbitraryTransaction({ name, identifier, payloadBytes, timestamp }) {
  const onChain = payloadBytes > 0 && payloadBytes <= MAX_ONCHAIN_FILE_SIZE;
  const dataBytes = onChain ? payloadBytes : 32;
  if (dataBytes > MAX_DATA_SIZE) fail(BROKER_ERROR.FEE_INVALID, 'The reconstructed ARBITRARY data length exceeds the Core maximum.');
  const parts = [
    uint32(TX_TYPE_ARBITRARY),
    int64(timestamp),
    uint32(0),
    zeroes(64),
    zeroes(32),
    uint32(0),
    sizedString(name),
    sizedString(identifier),
    uint32(METHOD_PUT),
    uint32(0),
    uint32(onChain ? COMPRESSION_NONE : COMPRESSION_ZIP),
    uint32(0),
    uint32(SERVICE_DOCUMENT),
    Buffer.from([onChain ? DATA_TYPE_RAW : DATA_TYPE_HASH]),
    uint32(dataBytes),
    zeroes(dataBytes),
    uint32(payloadBytes),
    uint32(onChain ? 0 : 32),
    onChain ? Buffer.alloc(0) : zeroes(32),
    int64(0)
  ];
  return Buffer.concat(parts);
}

function parseAtomicInteger(text, label) {
  const trimmed = String(text ?? '').trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    fail(BROKER_ERROR.FEE_UNAVAILABLE, label + ' did not return a non-negative integer atomic amount.');
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(BROKER_ERROR.FEE_UNAVAILABLE, label + ' returned an invalid or zero fee.');
  }
  return value;
}

async function requestText({ fetchImpl, url, init, timeoutMs, label, errorCode = BROKER_ERROR.FEE_UNAVAILABLE }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
  } catch (error) {
    fail(errorCode, label + ' request failed; the value cannot be determined.', {
      cause: error.message
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    fail(errorCode, label + ' request was rejected by the node.', {
      status: response.status
    });
  }
  try {
    return await response.text();
  } catch (error) {
    fail(errorCode, label + ' response could not be read.', { cause: error.message });
  }
}

/**
 * Read-only fee/balance oracle for one publication request. A single unit-fee
 * snapshot is used for every resource in the batch, while each resource gets
 * its own exact fee quote from the node.
 */
export function createFeeOracle({
  fetchImpl = globalThis.fetch,
  nodeUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  clock = () => Date.now()
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  if (typeof nodeUrl !== 'string' || nodeUrl.length === 0) throw new Error('nodeUrl is required');
  const base = nodeUrl.replace(/\/+$/, '');

  async function unitFee(timestamp = clock()) {
    const text = await requestText({
      fetchImpl,
      url: base + '/transactions/unitfee?txType=ARBITRARY&timestamp=' + encodeURIComponent(String(timestamp)),
      init: { method: 'GET' },
      timeoutMs,
      label: 'ARBITRARY unit fee'
    });
    return parseAtomicInteger(text, 'ARBITRARY unit fee');
  }

  async function recommendedFee({ name, identifier, payloadBytes, timestamp = clock() }) {
    const bytes = buildUnsignedArbitraryTransaction({ name, identifier, payloadBytes, timestamp });
    const text = await requestText({
      fetchImpl,
      url: base + '/transactions/fee',
      init: {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: base58Encode(bytes)
      },
      timeoutMs,
      label: 'recommended ARBITRARY fee'
    });
    return parseAtomicInteger(text, 'recommended ARBITRARY fee');
  }

  async function quoteResources({ name, resources, timestamp = clock() }) {
    const unit = await unitFee(timestamp);
    const quotes = [];
    for (const resource of resources) {
      const feeAtomic = await recommendedFee({
        name,
        identifier: resource.identifier,
        payloadBytes: resource.bytes,
        timestamp
      });
      if (feeAtomic % unit !== 0) {
        fail(BROKER_ERROR.FEE_MISMATCH, 'The node fee quote is not an exact multiple of the current ARBITRARY unit fee.');
      }
      quotes.push({ id: resource.id, feeAtomic, unitFeeAtomic: unit });
    }
    return { unitFeeAtomic: unit, quotes };
  }

  async function confirmedBalance(address) {
    const text = await requestText({
      fetchImpl,
      url: base + '/addresses/balance/' + encodeURIComponent(address),
      init: { method: 'GET' },
      timeoutMs,
      label: 'confirmed wallet balance',
      errorCode: BROKER_ERROR.BALANCE_UNAVAILABLE
    });
    let value = String(text ?? '').trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      return qortToAtomic(value, 'confirmed wallet balance');
    } catch {
      fail(BROKER_ERROR.BALANCE_UNAVAILABLE, 'The node did not return a usable confirmed QORT balance.');
    }
  }

  async function actualTransactionFee(signature) {
    const text = await requestText({
      fetchImpl,
      url: base + '/transactions/signature/' + encodeURIComponent(signature),
      init: { method: 'GET' },
      timeoutMs,
      label: 'transaction fee lookup'
    });
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      fail(BROKER_ERROR.FEE_UNAVAILABLE, 'The transaction fee lookup returned invalid JSON.');
    }
    const fee = parsed?.fee;
    if (!Number.isSafeInteger(fee) || fee <= 0) {
      fail(BROKER_ERROR.FEE_UNAVAILABLE, 'The transaction fee lookup did not return a usable fee.');
    }
    return fee;
  }

  return { unitFee, recommendedFee, quoteResources, confirmedBalance, actualTransactionFee };
}
