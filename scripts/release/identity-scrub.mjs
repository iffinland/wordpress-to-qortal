/**
 * Remove the one public, pinned update-registry reference before scanning a
 * Q-App bundle for hardcoded identities.
 *
 * The registry name is public data, not a Qortal ownership claim. Only the
 * exact name/identifier pair is removed; any other occurrence of a hardcoded
 * owner name remains visible to the security scanner.
 */
const FORWARD = /["']?name["']?\s*:\s*["']developer iffi["']\s*,\s*["']?identifier["']?\s*:\s*["']qms-update-registry["']/g;
const REVERSE = /["']?identifier["']?\s*:\s*["']qms-update-registry["']\s*,\s*["']?name["']?\s*:\s*["']developer iffi["']/g;

export function stripPinnedRegistryIdentity(text) {
  return String(text).replace(FORWARD, '').replace(REVERSE, '');
}
