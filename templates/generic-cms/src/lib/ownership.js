/**
 * Owner authorization for the generic CMS.
 *
 * Security invariants:
 * - The authorization target (qdnName) comes from the hosting context, never
 *   from a query parameter, localStorage, React state or a CMS config edit.
 * - Ownership is only granted when the live name record names the same QDN
 *   name and its on-chain owner is the active account address.
 * - Every uncertainty (missing bridge, missing account, missing name record,
 *   node error, mismatched address) fails closed.
 * - A remembered identity is never authorization for a mutation; callers must
 *   revalidate immediately before publishing or changing state.
 */

export function normalizeQortalName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function reader(reason, message, extra = {}) {
  return {
    role: 'reader',
    owner: false,
    reason,
    message,
    address: extra.address || '',
    name: extra.name || '',
    names: Array.isArray(extra.names) ? extra.names : [],
    qdnName: extra.qdnName || '',
    bridgeAvailable: Boolean(extra.bridgeAvailable),
    nameRecordStatus: extra.nameRecordStatus || 'none',
    nameRecordSource: extra.nameRecordSource || '',
    nameRecordError: extra.nameRecordError || '',
    // The UI uses this to offer one precise recovery action:
    // - connect: ask Qortal Hub for the active account (user gesture)
    // - retry: re-run the ownership check (registry/name list unreadable)
    // - open-in-hub: no bridge, the page must be opened inside Hub
    // - none: the resolved facts are conclusive; do not offer a bypass
    action: extra.action || 'none'
  };
}

/**
 * Evaluate ownership from already-fetched facts. This function is pure so the
 * complete fail-closed matrix is unit-testable.
 */
export function evaluateOwnership(options = {}) {
  const qdnName = normalizeQortalName(options.qdnName);
  const account = options.account || null;
  const names = Array.isArray(options.accountNames) ? options.accountNames.map(normalizeQortalName).filter(Boolean) : [];
  const nameRecord = options.nameRecord || null;
  const bridgeAvailable = options.bridgeAvailable !== false;
  const base = {
    address: account && account.address ? String(account.address) : '',
    name: normalizeQortalName(options.displayName || names[0] || ''),
    names,
    qdnName,
    bridgeAvailable,
    nameRecordSource: options.nameRecordSource || (nameRecord ? 'node' : ''),
    nameRecordError: options.nameRecordError || ''
  };

  if (!qdnName) {
    return reader('no-site-name', 'No QDN site name is known, so administrative actions stay read-only.', base);
  }
  if (!bridgeAvailable) {
    return reader(
      'bridge-unavailable',
      'The Qortal request bridge is unavailable, so the active account cannot be read. Open this site inside Qortal Hub (qortal://WEBSITE/' + encodeURIComponent(qdnName) + '/) to use owner mode. Read-only mode is active.',
      { ...base, action: 'open-in-hub' }
    );
  }
  if (!base.address) {
    return reader(
      'no-account',
      'No active Qortal account was returned. Use "Connect owner account" below and approve the request in Qortal Hub. Read-only mode is active.',
      { ...base, nameRecordStatus: nameRecord ? 'verified' : 'none', action: 'connect' }
    );
  }
  if (!nameRecord) {
    return reader(
      'name-record-unavailable',
      'The Qortal name registry could not be read, so ownership of ' + qdnName + ' cannot be verified. Read-only mode is active. Check the node connection, then retry the ownership check.',
      { ...base, nameRecordStatus: 'unavailable', action: 'retry' }
    );
  }
  const recordName = normalizeQortalName(nameRecord.name);
  if (!recordName) {
    return reader('name-record-invalid', 'The name record did not include a name. Owner mode is disabled.', { ...base, nameRecordStatus: 'invalid' });
  }
  if (recordName !== qdnName) {
    return reader(
      'name-record-mismatch',
      'The name record is for ' + recordName + ', not ' + qdnName + '. Owner mode is disabled.',
      { ...base, nameRecordStatus: 'mismatch' }
    );
  }
  if (!nameRecord.owner || String(nameRecord.owner) !== base.address) {
    return reader(
      'owner-address-mismatch',
      'The on-chain owner of ' + qdnName + ' is ' + String(nameRecord.owner || '(unknown)') + ', not the active account ' + base.address + '. Owner mode is disabled. Switch to the owning account in Qortal Hub, then retry.',
      { ...base, nameRecordStatus: 'mismatch' }
    );
  }
  // The on-chain record is conclusive. It must still agree with the account's
  // registered-name list from the bridge. An unreadable list is reported
  // separately from a real non-owner so the owner is not told their name is
  // "not owned" when the bridge action was simply unavailable.
  if (names.length === 0) {
    return reader(
      'name-list-unavailable',
      'The active account name list could not be read from Qortal Hub, so ownership of ' + qdnName + ' cannot be confirmed. Read-only mode is active. Retry the ownership check.',
      { ...base, nameRecordStatus: 'verified', action: 'retry' }
    );
  }
  if (!names.some((name) => name === qdnName)) {
    return reader(
      'name-not-owned',
      'The active account is not registered to ' + qdnName + '. Owner mode is disabled.',
      { ...base, nameRecordStatus: 'verified' }
    );
  }
  return {
    role: 'owner',
    owner: true,
    reason: 'name-record-verified',
    message: 'Owner mode is enabled. ' + qdnName + ' is owned by the active account.',
    ...base,
    nameRecordStatus: 'verified',
    action: 'none'
  };
}

export function canMutate(identity) {
  return Boolean(
    identity
    && identity.owner === true
    && identity.role === 'owner'
    && identity.nameRecordStatus === 'verified'
    && identity.address
    && identity.qdnName
  );
}

export function requireOwner(identity, action = 'this action') {
  if (!canMutate(identity)) {
    return {
      ok: false,
      error: 'read-only',
      message: 'Only the verified on-chain owner of ' + (identity && identity.qdnName ? identity.qdnName : 'this QDN name') + ' can perform ' + action + '.'
    };
  }
  return { ok: true, error: null, message: '' };
}

/**
 * Verify that a previously resolved identity is still the same active account
 * and still owns the same name. Used immediately before a mutation.
 */
export function evaluateRevalidation(identity, facts = {}) {
  const guard = requireOwner(identity, 'publishing changes');
  if (!guard.ok) return { ok: false, error: guard.error, message: guard.message, identity: null };
  const account = facts.account || null;
  const address = account && account.address ? String(account.address) : '';
  if (!address) {
    return { ok: false, error: 'no-account', message: 'No active Qortal account is available. Publishing was cancelled.', identity: null };
  }
  if (address !== identity.address) {
    return { ok: false, error: 'account-changed', message: 'The active Qortal account changed. Sign in again and retry. Publishing was cancelled.', identity: null };
  }
  const next = evaluateOwnership({
    qdnName: identity.qdnName,
    account: { address },
    accountNames: facts.accountNames || [],
    nameRecord: facts.nameRecord || null,
    nameRecordSource: facts.nameRecordSource || '',
    nameRecordError: facts.nameRecordError || '',
    bridgeAvailable: true,
    displayName: identity.name
  });
  if (!next.owner) {
    return { ok: false, error: next.reason, message: next.message, identity: next };
  }
  return { ok: true, error: null, message: '', identity: next };
}

