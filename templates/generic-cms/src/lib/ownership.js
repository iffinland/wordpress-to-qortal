export function normalizeQortalName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function reader(reason, message, extra = {}) {
  return {
    role: 'reader',
    owner: false,
    reason,
    message,
    address: extra.address || '',
    name: extra.name || '',
    names: extra.names || [],
    qdnName: extra.qdnName || '',
    bridgeAvailable: Boolean(extra.bridgeAvailable),
    nameRecordStatus: extra.nameRecordStatus || 'none'
  };
}

export function evaluateOwnership(options = {}) {
  const qdnName = String(options.qdnName || '').trim();
  const account = options.account || null;
  const names = Array.isArray(options.accountNames) ? options.accountNames.map(String) : [];
  const nameRecord = options.nameRecord || null;
  const bridgeAvailable = Boolean(options.bridgeAvailable);
  const normalizedTarget = normalizeQortalName(qdnName);
  const base = {
    address: account && account.address ? String(account.address) : '',
    name: String(options.displayName || names[0] || ''),
    names,
    qdnName,
    bridgeAvailable
  };

  if (!normalizedTarget) {
    return reader('no-site-name', 'No QDN site name is configured, so administrative actions stay read-only.', base);
  }
  if (!account || !account.address) {
    return reader('no-account', 'No Qortal account was returned. Sign in through Qortal UI to use owner mode.', { ...base, nameRecordStatus: nameRecord ? 'verified' : 'none' });
  }
  const ownedNames = names.filter(Boolean);
  if (!ownedNames.some((item) => normalizeQortalName(item) === normalizedTarget)) {
    return reader('name-not-owned', 'The signed-in account does not own ' + qdnName + '. This site is read-only.', { ...base, nameRecordStatus: nameRecord ? 'verified' : 'none' });
  }
  if (nameRecord) {
    const recordName = normalizeQortalName(nameRecord.name);
    if (recordName && recordName !== normalizedTarget) {
      return reader('name-record-mismatch', 'The QDN name record does not match ' + qdnName + '. Owner mode is disabled.', { ...base, nameRecordStatus: 'mismatch' });
    }
    if (nameRecord.owner && String(nameRecord.owner) !== String(account.address)) {
      return reader('owner-address-mismatch', 'The on-chain owner of ' + qdnName + ' is not the signed-in account. Owner mode is disabled.', { ...base, nameRecordStatus: 'mismatch' });
    }
    return {
      role: 'owner',
      owner: true,
      reason: 'name-record-verified',
      message: 'Owner mode is enabled. ' + qdnName + ' is owned by the signed-in account.',
      ...base,
      nameRecordStatus: 'verified'
    };
  }
  if (options.requireNameRecord) {
    return reader('name-record-unavailable', 'The name ownership record could not be verified, so owner mode is disabled.', { ...base, nameRecordStatus: 'unavailable' });
  }
  return {
    role: 'owner',
    owner: true,
    reason: 'account-names-verified',
    message: 'Owner mode is enabled by the signed-in account name list for ' + qdnName + '.',
    ...base,
    nameRecordStatus: 'unavailable'
  };
}

export function canMutate(identity) {
  return Boolean(identity && identity.owner === true && identity.role === 'owner');
}

export function requireOwner(identity, action = 'this action') {
  if (!canMutate(identity)) {
    return {
      ok: false,
      error: 'read-only',
      message: 'Only the verified owner of the QDN site name can perform ' + action + '.'
    };
  }
  return { ok: true, error: null, message: '' };
}
