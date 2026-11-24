import { publishedFileMatches, verifyPublishedFile } from './fileVerification.js';
/**
 * Owner-guarded publication. Every function revalidates the active account
 * against the on-chain name owner immediately before writing. A submitted
 * transaction is never treated as success; exact QDN read-back is required.
 * Uncertain outcomes are parked as ambiguous and are never auto-resent.
 */

import {
  fetchQdnResource,
  fetchUnitFee,
  getQdnResourceStatus,
  publishQdnResource,
  publishQdnResources,
  revalidateViewerIdentity,
  sha256Hex,
  verifyPublishedBytes
} from './qortal.js';
import { stableStringify } from './settings.js';
import { readFileBytes } from './mediaBytes.js';

const inFlight = new Map();
export const PENDING_SCHEMA = 'qms-cms-publish-pending@1';
export const PENDING_KEY = 'qms-cms-publish-pending@1';

function pendingStorage(storage) {
  return storage || (typeof localStorage === 'undefined' ? null : localStorage);
}

export function readPending(storage) {
  const target = pendingStorage(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed && parsed.schema === PENDING_SCHEMA && Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

function writePending(storage, entries) {
  const target = pendingStorage(storage);
  if (!target) return false;
  try {
    target.setItem(PENDING_KEY, JSON.stringify({ schema: PENDING_SCHEMA, entries }));
    return true;
  } catch {
    return false;
  }
}

export function recordPending(storage, record) {
  const entries = readPending(storage).filter((entry) => entry.key !== record.key);
  entries.push(record);
  return writePending(storage, entries);
}

export function clearPending(storage, key) {
  return writePending(storage, readPending(storage).filter((entry) => entry.key !== key));
}

export function resourceKey(service, name, identifier) {
  return service + '|' + name + '|' + identifier;
}

export function serialiseJsonDocument(document) {
  return new TextEncoder().encode(stableStringify(document) + '\n');
}

export function isDeclinedError(error) {
  const message = String(error && error.message ? error.message : error || '').toLowerCase();
  return message.includes('declin') || message.includes('reject') || message.includes('cancel') || message.includes('denied');
}

async function guardOwner(identity) {
  const result = await revalidateViewerIdentity(identity);
  if (!result.ok) {
    const error = new Error(result.message);
    error.code = result.error || 'not-owner';
    throw error;
  }
  return result.identity;
}

export async function quotePublication(count = 1) {
  const unitFee = await fetchUnitFee('ARBITRARY');
  const resources = Math.max(1, Number(count) || 1);
  return {
    unitFee,
    resources,
    total: unitFee == null ? null : unitFee * resources,
    currency: 'QORT',
    label: unitFee == null
      ? 'Fee unavailable from the node. Qortal Hub will show the exact fee before signing.'
      : (unitFee * resources / 100000000).toFixed(8) + ' QORT for ' + resources + ' resource(s), at node unit fee ' + unitFee + '. Hub shows the final fee before signing.'
  };
}

export async function readRemoteJson(service, name, identifier) {
  try {
    return await fetchQdnResource({ service, name, identifier }, 10000);
  } catch {
    return null;
  }
}

function bytesToBase64Bytes(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export async function publishJsonResource({
  identity,
  service = 'DOCUMENT',
  name,
  identifier,
  document,
  title,
  description,
  force = false,
  storage,
  verifyTimeoutMs = 60000
}) {
  const key = resourceKey(service, name, identifier);
  if (inFlight.has(key)) return { ok: false, state: 'in-flight', message: 'This resource is already being published in another action.' };
  inFlight.set(key, true);
  try {
    const owner = await guardOwner(identity);
    const bytes = serialiseJsonDocument(document);
    const sha256 = await sha256Hex(bytes);
    const pending = readPending(storage).find((entry) => entry.key === key);

    if (pending && !force) {
      if (pending.sha256 === sha256) {
        const verification = await verifyPublishedBytes({ service, name, identifier, expectedBytes: bytes, timeoutMs: verifyTimeoutMs });
        if (verification.ok) {
          clearPending(storage, key);
          return { ok: true, state: 'remote-verified', sha256, verification, identity: owner, message: 'The earlier submission is confirmed on QDN.' };
        }
        return {
          ok: false,
          state: 'ambiguous',
          sha256,
          message: 'An earlier submission for this exact content is still unconfirmed. It was NOT resent. Check the resource in Qortal Hub, then retry verification.'
        };
      }
      return {
        ok: false,
        state: 'ambiguous',
        sha256,
        message: 'A different submission for this resource is unconfirmed. Resolve or discard it before publishing new bytes.'
      };
    }

    recordPending(storage, {
      key, service, name, identifier, sha256, bytes: bytes.length,
      submittedAt: new Date().toISOString(), owner: owner.address, title: title || ''
    });

    try {
      await publishQdnResource({
        service, name, identifier,
        data64: bytesToBase64Bytes(bytes),
        filename: identifier + '.json',
        title: title || identifier,
        description: description || 'Published from the Qortal Migration Studio CMS.'
      });
    } catch (error) {
      if (isDeclinedError(error)) {
        clearPending(storage, key);
        return { ok: false, state: 'declined', message: error.message || 'The signature request was declined.', identity: owner };
      }
      return {
        ok: false, state: 'ambiguous',
        message: 'The publish request ended without a confirmed result. It was NOT resent automatically. Verify the resource before retrying. ' + (error && error.message ? error.message : ''),
        identity: owner
      };
    }

    const verification = await verifyPublishedBytes({ service, name, identifier, expectedBytes: bytes, timeoutMs: verifyTimeoutMs });
    if (!verification.ok) {
      return {
        ok: false, state: 'ambiguous', sha256,
        message: 'Submitted, but exact QDN read-back did not match yet. It was NOT resent. Retry verification after the transaction confirms.',
        verification, identity: owner
      };
    }
    clearPending(storage, key);
    return { ok: true, state: 'remote-verified', sha256, verification, identity: owner, message: 'Published and verified byte-for-byte.' };
  } catch (error) {
    return { ok: false, state: error.code === 'not-owner' ? 'denied' : 'failed', message: error.message || String(error) };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * @typedef {Object} BatchResource
 * @property {string} [service]   default DOCUMENT
 * @property {string} identifier
 * @property {any} [document]     JSON document (serialised deterministically)
 * @property {Uint8Array} [bytes] raw bytes (media)
 * @property {Blob} [file]        large resource published through the Hub file path (no base64 in memory)
 * @property {string} [sha256]    required with `file`: precomputed content hash
 * @property {string} [filename]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [tag1]      first Core metadata tag (Q-Tube uses 'qtube_vid_')
 * @property {boolean} [reuseIfReady] skip when identical bytes are already READY
 * @property {string} [stage]     caller label, echoed back
 */

/**
 * Publish many resources with ONE Hub approval and verify each one.
 *
 * Caller contract: every document is already computed. This function
 * revalidates the owner once, records all pending entries, sends exactly one
 * batch request, maps Hub's unsuccessfulPublishes to per-resource states and
 * read-back verifies each resource. It never resends. The sequential
 * single-resource path is used ONLY when the Hub clearly does not support the
 * batch action (error before any approval or publish). It is never used after
 * a decline, a partial success or an ambiguous result.
 *
 * Per-resource states: remote-verified | reused | declined | failed | ambiguous
 * | not-sent.
 */
async function verifyReady({ service, name, identifier, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getQdnResourceStatus(service, name, identifier);
    if (status && status.status === 'READY') return { ok: true };
    if (Date.now() >= deadline) return { ok: false };
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000, Math.max(50, timeoutMs / 20))));
  }
}

async function verifyEntry(entry, name, timeoutMs) {
  if (entry.item.file && entry.item.verifyFileHash) return verifyPublishedFile({
    service: entry.service, name, identifier: entry.item.identifier, size: entry.size, sha256: entry.sha256,
    timeoutMs: Math.max(timeoutMs, 120000, Math.ceil(entry.size / (1024 * 1024)) * 2000)
  });
  if (entry.item.file) return verifyReady({ service: entry.service, name, identifier: entry.item.identifier, timeoutMs: Math.max(timeoutMs, 120000) });
  return verifyPublishedBytes({ service: entry.service, name, identifier: entry.item.identifier, expectedBytes: entry.bytes, timeoutMs });
}

export async function publishBatch({ identity, name, resources, storage, verifyTimeoutMs = 60000, onProgress = undefined }) {
  // A featured image and video poster can be the same resource. Include it once,
  // but never silently choose between different bytes at identical coordinates.
  const distinct = new Map();
  try {
    for (const item of resources) {
      const key = resourceKey(item.service || 'DOCUMENT', name, item.identifier);
      const previous = distinct.get(key);
      if (previous) {
        const digest = async (entry) => entry.file ? String(entry.sha256 || '')
          : sha256Hex(entry.bytes ? mediaBytes(entry.bytes) : serialiseJsonDocument(entry.document));
        if (await digest(previous) !== await digest(item)) {
          return { ok: false, state: 'failed', results: [], message: 'Different payloads target the same QDN resource: ' + item.identifier + '. Nothing was sent.' };
        }
      } else distinct.set(key, item);
    }
  } catch (error) {
    return { ok: false, state: 'failed', results: [], message: 'The publication could not be prepared. Nothing was sent. ' + (error.message || error) };
  }
  resources = [...distinct.values()];
  const keys = resources.map((item) => resourceKey(item.service || 'DOCUMENT', name, item.identifier));
  const held = [];
  for (const key of keys) {
    if (inFlight.has(key)) {
      held.forEach((entry) => inFlight.delete(entry));
      return { ok: false, state: 'in-flight', message: 'A resource in this batch is already being published in another action.', results: [] };
    }
    inFlight.set(key, true);
    held.push(key);
  }
  const notify = () => { if (onProgress) { try { onProgress(results.map((entry) => ({ stage: entry.stage, identifier: entry.identifier, state: entry.state }))); } catch { /* UI callback only */ } } };
  const results = resources.map((item, index) => ({
    stage: item.stage || item.identifier, service: item.service || 'DOCUMENT', identifier: item.identifier,
    key: keys[index], ok: false, state: 'not-sent', message: ''
  }));
  try {
    const owner = await guardOwner(identity);
    const prepared = [];
    for (let index = 0; index < resources.length; index += 1) {
      const item = resources[index];
      const service = item.service || 'DOCUMENT';
      const bytes = item.file ? null : (item.bytes ? mediaBytes(item.bytes) : serialiseJsonDocument(item.document));
      const sha256 = item.file ? String(item.sha256 || '') : await sha256Hex(bytes);
      if (item.file && !sha256) throw new Error('A precomputed SHA-256 is required for file resources.');
      const entry = { index, item, service, bytes, size: item.file ? item.file.size : bytes.length, sha256, key: keys[index] };
      results[index].sha256 = sha256;
      if (item.reuseIfReady) {
        const status = await getQdnResourceStatus(service, name, item.identifier);
        if (status && status.status === 'READY' && (!item.file || !item.verifyFileHash || await publishedFileMatches({ service, name, identifier: item.identifier, size: entry.size, sha256, timeoutMs: Math.max(120000, Math.ceil(entry.size / (1024 * 1024)) * 2000) }))) {
          Object.assign(results[index], { ok: true, state: 'reused', message: 'Reused an existing QDN resource with identical bytes.' });
          continue;
        }
      }
      const pending = readPending(storage).find((candidate) => candidate.key === entry.key);
      if (pending) {
        if (pending.sha256 !== sha256) {
          return {
            ok: false, state: 'ambiguous', identity: owner, results,
            message: 'A different submission for ' + item.identifier + ' is unconfirmed. Resolve or discard it before publishing new bytes. Nothing was sent.'
          };
        }
        const verification = await verifyEntry(entry, name, verifyTimeoutMs);
        if (verification.ok) {
          clearPending(storage, entry.key);
          Object.assign(results[index], { ok: true, state: 'remote-verified', message: 'The earlier submission is confirmed on QDN.' });
          continue;
        }
        return {
          ok: false, state: 'ambiguous', identity: owner, results,
          message: 'An earlier submission for ' + item.identifier + ' is still unconfirmed. It was NOT resent. Check Qortal Hub, then retry verification.'
        };
      }
      prepared.push(entry);
    }

    const finish = () => {
      const failed = results.filter((entry) => !entry.ok);
      const verifiedCount = results.length - failed.length;
      if (failed.length === 0) return { ok: true, state: 'remote-verified', identity: owner, results, message: 'Published and verified byte-for-byte.' };
      const first = failed[0];
      const state = failed.some((entry) => entry.state === 'ambiguous') ? 'ambiguous'
        : verifiedCount > 0 ? 'partial'
        : first.state;
      return { ok: false, state, identity: owner, results, message: first.message };
    };
    if (prepared.length === 0) return finish();

    prepared.forEach((entry) => recordPending(storage, {
      key: entry.key, service: entry.service, name, identifier: entry.item.identifier, sha256: entry.sha256, bytes: entry.size,
      submittedAt: new Date().toISOString(), owner: owner.address, title: entry.item.title || ''
    }));
    const toPayload = (entry) => ({
      service: entry.service, name, identifier: entry.item.identifier,
      ...(entry.item.file ? { file: entry.item.file } : { data64: bytesToBase64Bytes(entry.bytes) }),
      filename: entry.item.filename || (entry.item.bytes ? entry.item.identifier : entry.item.identifier + '.json'),
      title: entry.item.title || entry.item.identifier,
      description: entry.item.description || 'Published from the Qortal Migration Studio CMS.',
      ...(entry.item.tag1 ? { tag1: entry.item.tag1 } : {})
    });

    prepared.forEach((entry) => { results[entry.index].state = 'queued'; });
    notify();
    const totalFileBytes = prepared.reduce((sum, entry) => sum + (entry.item.file ? entry.size : 0), 0);
    let sent = null;
    let fallbackUsed = false;
    try {
      // Hub publishes sequentially (about 1 s between resources) after one approval;
      // large files need a longer request window than the default.
      sent = await publishQdnResources(prepared.map(toPayload), { timeoutMs: 300000 + Math.ceil(totalFileBytes / (1024 * 1024)) * 2000 });
    } catch (error) {
      if (error && error.code === 'declined') {
        prepared.forEach((entry) => { clearPending(storage, entry.key); results[entry.index].state = 'declined'; results[entry.index].message = error.message || 'The signature request was declined.'; });
        return { ...finish(), state: 'declined', message: error.message || 'The signature request was declined.' };
      }
      if (error && error.code === 'unsupported') {
        fallbackUsed = true;
      } else if (error && error.code === 'partial') {
        sent = { unsuccessful: error.unsuccessful || [] };
      } else {
        prepared.forEach((entry) => {
          results[entry.index].state = 'ambiguous';
          results[entry.index].message = 'The batch request ended without a confirmed result. It was NOT resent. Verify the resource before retrying. ' + (error && error.message ? error.message : '');
        });
        return { ...finish(), state: 'ambiguous', message: 'The batch publish request ended without a confirmed result. Nothing was resent. Verify the resources before retrying. ' + (error && error.message ? error.message : '') };
      }
    }

    if (fallbackUsed) {
      // The Hub rejected the action itself, so nothing was approved or published.
      for (const entry of prepared) {
        try {
          await publishQdnResource(toPayload(entry));
        } catch (error) {
          if (isDeclinedError(error)) {
            clearPending(storage, entry.key);
            results[entry.index].state = 'declined';
            results[entry.index].message = error.message || 'The signature request was declined.';
          } else {
            results[entry.index].state = 'ambiguous';
            results[entry.index].message = 'The publish request ended without a confirmed result. It was NOT resent. ' + (error && error.message ? error.message : '');
          }
          prepared.filter((rest) => rest.index > entry.index).forEach((rest) => { clearPending(storage, rest.key); });
          return { ...finish(), fallbackUsed: true };
        }
        // Verify each fallback resource before asking Hub to sign the next one.
        const verification = await verifyEntry(entry, name, verifyTimeoutMs);
        if (verification.ok) {
          clearPending(storage, entry.key);
          Object.assign(results[entry.index], { ok: true, state: 'remote-verified', message: 'Published and verified byte-for-byte.', verification });
        } else {
          results[entry.index].state = 'ambiguous';
          results[entry.index].message = 'Submitted, but exact QDN read-back did not match yet. It was NOT resent.';
          prepared.filter((rest) => rest.index > entry.index).forEach((rest) => { clearPending(storage, rest.key); });
          return { ...finish(), fallbackUsed: true };
        }
      }
      return { ...finish(), fallbackUsed: true };
    }

    const unsuccessful = new Set(sent.unsuccessful || []);
    prepared.forEach((entry) => { results[entry.index].state = unsuccessful.has(entry.item.identifier) ? 'failed' : 'verifying'; });
    notify();
    for (const entry of prepared) {
      if (unsuccessful.has(entry.item.identifier)) {
        clearPending(storage, entry.key);
        results[entry.index].state = 'failed';
        results[entry.index].message = 'Qortal Hub reported that ' + entry.item.identifier + ' was not published.';
        continue;
      }
      const verification = await verifyEntry(entry, name, verifyTimeoutMs);
      if (verification.ok) {
        clearPending(storage, entry.key);
        Object.assign(results[entry.index], { ok: true, state: 'remote-verified', message: 'Published and verified byte-for-byte.', verification });
      } else {
        results[entry.index].state = 'ambiguous';
        results[entry.index].message = 'Submitted, but exact QDN read-back of ' + entry.item.identifier + ' did not match yet. It was NOT resent.';
      }
      notify();
    }
    return finish();
  } catch (error) {
    return { ok: false, state: error.code === 'not-owner' ? 'denied' : 'failed', message: error.message || String(error), results };
  } finally {
    held.forEach((entry) => inFlight.delete(entry));
  }
}

/**
 * Prepare a local media file for a batch: computes its stable identifier and
 * reference from the captured bytes without publishing anything.
 */
export async function prepareMediaResource({ name, bytes, filename = 'media', mimeType = '', title = '', description = '' }) {
  const captured = mediaBytes(bytes);
  if (!captured.length) throw new Error('The selected image is empty. Choose another file.');
  const sha256 = await sha256Hex(captured);
  const service = serviceForMime(mimeType, filename);
  const identifier = ('qms-cms-media-' + sha256.slice(0, 32)).slice(0, 64);
  const payloadName = extensionFor(mimeType) && !/\.[a-z0-9]+$/i.test(filename) ? filename + '.' + extensionFor(mimeType) : filename;
  return {
    resource: { stage: 'media', service, identifier, bytes: captured, filename: payloadName, title: title || payloadName, description: description || 'Media published from the Qortal Migration Studio CMS.', reuseIfReady: true },
    ref: { service, name, identifier, mimeType: mimeType || null, bytes: captured.length, sha256 }
  };
}

function mediaBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || []);
}

function extensionFor(mime) {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'image/avif': 'avif', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf'
  };
  return map[String(mime || '').toLowerCase()] || '';
}

export function serviceForMime(mimeType, filename = '') {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  const extension = String(filename || '').toLowerCase().split('.').pop();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'].includes(extension)) return 'IMAGE';
  if (['mp4', 'webm', 'mov', 'mkv'].includes(extension)) return 'VIDEO';
  if (['mp3', 'ogg', 'wav', 'm4a'].includes(extension)) return 'AUDIO';
  return 'FILE';
}

export function serviceForFile(file) {
  return serviceForMime(file && file.type, file && file.name);
}

/**
 * @typedef {Object} PublishMediaOptions
 * @property {any} identity
 * @property {string} name
 * @property {File|null} [file]
 * @property {Uint8Array|ArrayBuffer|null} [bytes]
 * @property {string} [filename]
 * @property {string} [mimeType]
 * @property {string} [title]
 * @property {string} [description]
 * @property {Storage|null} [storage]
 * @property {number} [maxExactVerifyBytes]
 */

/**
 * Publish a local image or other media resource.
 *
 * Android Qortal Hub can revoke the picked file's content URI after the
 * selection event returns, so the original File reference must never be read
 * after an await. Callers that can capture bytes at selection pass them here;
 * otherwise the bytes are read once at the very start of this function, before
 * ownership verification or any network wait. The publication payload always
 * carries the captured bytes as base64 (Hub uploadType: base64), never the
 * original File object.
 *
 * @param {PublishMediaOptions} options
 */
export async function publishMediaFile(options = {}) {
  const {
    identity, name, file = null, bytes = null, filename = '', mimeType = '',
    title = '', description = '', storage = undefined,
    maxExactVerifyBytes = 25 * 1024 * 1024
  } = options;
  const sourceName = filename || (file && file.name) || 'media';
  const sourceType = mimeType || (file && file.type) || '';
  const key = 'media|' + name + '|' + sourceName + '|' + (bytes ? mediaBytes(bytes).length : (file && file.size) || 0);
  if (inFlight.has(key)) return { ok: false, state: 'in-flight', message: 'This file is already being published.' };
  inFlight.set(key, true);
  try {
    // Capture first, before guardOwner and before any other await.
    let captured;
    if (bytes) {
      captured = mediaBytes(bytes);
    } else if (file) {
      try {
        captured = await readFileBytes(file);
      } catch (readError) {
        return {
          ok: false, state: 'failed',
          message: 'The selected image could not be read from this device. Re-select it and try again. ' + (readError && readError.message ? readError.message : '')
        };
      }
    } else {
      return { ok: false, state: 'failed', message: 'No image bytes were captured. Re-select the featured image.' };
    }
    if (!captured.length) return { ok: false, state: 'failed', message: 'The selected image is empty. Choose another file.' };

    const sha256 = await sha256Hex(captured);
    const service = serviceForMime(sourceType, sourceName);
    const payloadName = extensionFor(sourceType) && !/\.[a-z0-9]+$/i.test(sourceName)
      ? sourceName + '.' + extensionFor(sourceType)
      : sourceName;
    const identifier = ('qms-cms-media-' + sha256.slice(0, 32)).slice(0, 64);
    const owner = await guardOwner(identity);
    const status = await getQdnResourceStatus(service, name, identifier);
    if (status && status.status === 'READY') {
      return {
        ok: true, state: 'reused',
        ref: { service, name, identifier, mimeType: sourceType || null, bytes: captured.length, sha256 },
        message: 'Reused an existing QDN resource with identical bytes.'
      };
    }
    const pendingKey = resourceKey(service, name, identifier);
    const pending = readPending(storage).find((entry) => entry.key === pendingKey);
    if (pending && pending.sha256 !== sha256) {
      return { ok: false, state: 'ambiguous', message: 'A different file submission is unconfirmed for this identifier. Resolve it before publishing.' };
    }
    if (!pending) {
      recordPending(storage, { key: pendingKey, service, name, identifier, sha256, bytes: captured.length, submittedAt: new Date().toISOString(), owner: owner.address });
      try {
        await publishQdnResource({
          service, name, identifier,
          data64: bytesToBase64Bytes(captured),
          filename: payloadName,
          title: title || payloadName,
          description: description || 'Media published from the Qortal Migration Studio CMS.'
        });
      } catch (error) {
        if (isDeclinedError(error)) {
          clearPending(storage, pendingKey);
          return { ok: false, state: 'declined', message: error.message || 'The signature request was declined.' };
        }
        return { ok: false, state: 'ambiguous', message: 'The media publish request was not confirmed. It was NOT resent. Verify the resource before retrying. ' + (error && error.message ? error.message : '') };
      }
    }
    if (captured.length <= maxExactVerifyBytes) {
      const verification = await verifyPublishedBytes({ service, name, identifier, expectedBytes: captured, timeoutMs: 60000 });
      if (!verification.ok) {
        return { ok: false, state: 'ambiguous', message: 'Media submitted but exact read-back is not confirmed yet. It was NOT resent.', ref: { service, name, identifier, mimeType: sourceType || null, bytes: captured.length, sha256 } };
      }
    } else {
      const check = await getQdnResourceStatus(service, name, identifier);
      if (!check || check.status !== 'READY') {
        return { ok: false, state: 'ambiguous', message: 'Large media submitted but is not confirmed READY yet. Retry verification later; it was NOT resent.', ref: { service, name, identifier, mimeType: sourceType || null, bytes: captured.length, sha256 } };
      }
    }
    clearPending(storage, pendingKey);
    return {
      ok: true, state: 'remote-verified',
      ref: { service, name, identifier, mimeType: sourceType || null, bytes: captured.length, sha256 },
      message: 'Media published and verified.'
    };
  } catch (error) {
    return { ok: false, state: error.code === 'not-owner' ? 'denied' : 'failed', message: error.message || String(error) };
  } finally {
    inFlight.delete(key);
  }
}

export async function fetchPublishedSettings(name) {
  return await readRemoteJson('DOCUMENT', name, 'qms-cms-site-settings');
}
