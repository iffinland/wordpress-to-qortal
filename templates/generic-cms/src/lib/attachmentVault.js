/**
 * Session-level attachment vault.
 *
 * Android Hub can revoke a picked file URI after the selection event. The
 * captured Blob/File must therefore survive editor remounts and draft
 * switching, not only React state inside one EditorPage instance. The vault is
 * keyed by the publishing name and site id; it is intentionally memory-only
 * (a 20 MB video cannot be stored in localStorage) and never grants ownership.
 */
const vaults = new Map();

export function attachmentVaultKey({ name = '', siteId = '' } = {}) {
  return String(name || '') + '|' + String(siteId || '');
}

export function attachmentVault(key) {
  const safe = String(key || '');
  if (!vaults.has(safe)) vaults.set(safe, new Map());
  return vaults.get(safe);
}

/**
 * Resolve a capture for an attachment node. Q-Tube rewrites the VIDEO
 * identifier from the CMS media id to the Q-Tube id before publication; the
 * captured bytes still live under the original id. Follow that alias.
 */
export function captureForIdentifier(store, identifier, videoMoves = []) {
  if (!store || identifier == null) return undefined;
  const direct = store.get(String(identifier));
  if (direct) return direct;
  const move = (Array.isArray(videoMoves) ? videoMoves : [])
    .find((entry) => entry && String(entry.to) === String(identifier));
  return move ? store.get(String(move.from)) : undefined;
}

export function clearAttachmentVault(key) {
  vaults.delete(String(key || ''));
}
