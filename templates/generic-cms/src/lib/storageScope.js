/**
 * Per-account, per-deployment local storage scope.
 *
 * Local drafts, pending publications, settings drafts and adoption records are
 * private working state, not published content. They are scoped by BOTH the
 * effective deployment identity (service, name, identifier and site id) and the
 * verified owner's stable Qortal address. A reader identity, a mismatched name
 * record or an unavailable bridge yields no scope, so no private local state is
 * read or written. Published content is still read from QDN by name.
 */

export function deploymentBinding(deployment, fallback = {}) {
  const service = String((deployment && deployment.service) || fallback.service || 'APP');
  const name = String((deployment && deployment.name) || fallback.name || '');
  const identifier = String((deployment && deployment.identifier) || fallback.identifier || 'default');
  const siteId = String(fallback.siteId || '');
  return { service, name, identifier, siteId };
}

export function verifiedOwnerAddress(identity) {
  if (!identity || identity.role !== 'owner' || identity.owner !== true) return '';
  if (identity.nameRecordStatus !== 'verified') return '';
  const address = String(identity.address || '').trim();
  return address;
}

export function storageScope({ deployment, identity, siteId } = {}) {
  const owner = verifiedOwnerAddress(identity);
  if (!owner) return null;
  const binding = deploymentBinding(deployment, { siteId });
  const key = [
    binding.service,
    encodeURIComponent(binding.name),
    encodeURIComponent(binding.identifier),
    encodeURIComponent(binding.siteId),
    owner
  ].join(':');
  return { owner, binding, key };
}

export function scopedKey(base, scope) {
  if (!scope || !scope.key) return null;
  return String(base) + '::' + scope.key;
}

export function readScopedJson(storage, base, scope) {
  const key = scopedKey(base, scope);
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeScopedJson(storage, base, scope, value) {
  const key = scopedKey(base, scope);
  if (!storage || !key) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeScoped(storage, base, scope) {
  const key = scopedKey(base, scope);
  if (!storage || !key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * A storage-shaped view whose keys carry the scope suffix. Used where an API
 * only accepts a Storage object (pending publish records, media publishes).
 */
export function createScopedStorage(storage, scope) {
  if (!storage || !scope || !scope.key) return null;
  return {
    getItem(key) { return storage.getItem(scopedKey(key, scope)); },
    setItem(key, value) { storage.setItem(scopedKey(key, scope), value); },
    removeItem(key) { storage.removeItem(scopedKey(key, scope)); }
  };
}

export function legacyKey(base, siteId) {
  return String(base) + ':' + String(siteId || 'site');
}
