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
  revalidateViewerIdentity,
  sha256Hex,
  verifyPublishedBytes
} from './qortal.js';
import { stableStringify } from './settings.js';

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

export function serviceForFile(file) {
  const mime = String(file && file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime === 'application/pdf' || mime.startsWith('application/')) return 'FILE';
  return 'FILE';
}

export async function publishMediaFile({ identity, name, file, title = '', description = '', storage = undefined, maxExactVerifyBytes = 25 * 1024 * 1024 }) {
  const key = 'media|' + name + '|' + (file && file.name) + '|' + (file && file.size);
  if (inFlight.has(key)) return { ok: false, state: 'in-flight', message: 'This file is already being published.' };
  inFlight.set(key, true);
  try {
    const owner = await guardOwner(identity);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    const service = serviceForFile(file);
    const identifier = ('qms-cms-media-' + sha256.slice(0, 32)).slice(0, 64);
    const status = await getQdnResourceStatus(service, name, identifier);
    if (status && status.status === 'READY') {
      return {
        ok: true, state: 'reused',
        ref: { service, name, identifier, mimeType: file.type || null, bytes: bytes.length, sha256 },
        message: 'Reused an existing QDN resource with identical bytes.'
      };
    }
    const pendingKey = resourceKey(service, name, identifier);
    const pending = readPending(storage).find((entry) => entry.key === pendingKey);
    if (pending && pending.sha256 !== sha256) {
      return { ok: false, state: 'ambiguous', message: 'A different file submission is unconfirmed for this identifier. Resolve it before publishing.' };
    }
    if (!pending) {
      recordPending(storage, { key: pendingKey, service, name, identifier, sha256, bytes: bytes.length, submittedAt: new Date().toISOString(), owner: owner.address });
      try {
        await publishQdnResource({
          service, name, identifier, file,
          filename: file.name,
          title: title || file.name,
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
    if (bytes.length <= maxExactVerifyBytes) {
      const verification = await verifyPublishedBytes({ service, name, identifier, expectedBytes: bytes, timeoutMs: 60000 });
      if (!verification.ok) {
        return { ok: false, state: 'ambiguous', message: 'Media submitted but exact read-back is not confirmed yet. It was NOT resent.', ref: { service, name, identifier, mimeType: file.type || null, bytes: bytes.length, sha256 } };
      }
    } else {
      const check = await getQdnResourceStatus(service, name, identifier);
      if (!check || check.status !== 'READY') {
        return { ok: false, state: 'ambiguous', message: 'Large media submitted but is not confirmed READY yet. Retry verification later; it was NOT resent.', ref: { service, name, identifier, mimeType: file.type || null, bytes: bytes.length, sha256 } };
      }
    }
    clearPending(storage, pendingKey);
    return {
      ok: true, state: 'remote-verified',
      ref: { service, name, identifier, mimeType: file.type || null, bytes: bytes.length, sha256 },
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
