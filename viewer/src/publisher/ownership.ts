import { checkQortalName } from './name.ts';

export interface OwnedName {
  name: string;
  owner: string;
}

export type OwnershipState = 'verified' | 'blocked';

export interface OwnershipResult {
  state: OwnershipState;
  code: string;
  message: string;
  name?: string;
  accountAddress?: string;
}

/**
 * Publisher-side precondition. GET_ACCOUNT_NAMES returns the exact registered
 * display name and owner for the active account. Compare both strictly:
 * a case-folded, reduced or normalized name is not ownership evidence, and an
 * entry without an owner is inconclusive, therefore blocked.
 */
export function evaluateNameOwnership({
  targetName,
  accountAddress,
  ownedNames
}: {
  targetName: string;
  accountAddress?: string | null;
  ownedNames: OwnedName[];
}): OwnershipResult {
  const checked = checkQortalName(targetName);
  if (!checked.ok) {
    return { state: 'blocked', code: checked.code, message: checked.message };
  }
  if (typeof accountAddress !== 'string' || accountAddress === '') {
    return { state: 'blocked', code: 'ACCOUNT_REQUIRED', message: 'Connect the owning Qortal account first.', name: checked.name };
  }
  const matching = (ownedNames ?? []).filter((entry) => entry && entry.name === checked.name);
  if (matching.length === 0) {
    return {
      state: 'blocked',
      code: 'NAME_NOT_OWNED',
      message: 'The active account does not own the exact registered name "' + checked.name + '".',
      name: checked.name,
      accountAddress
    };
  }
  if (matching.some((entry) => entry.owner === accountAddress)) {
    return { state: 'verified', code: 'NAME_OWNERSHIP_VERIFIED', message: 'Name ownership verified.', name: checked.name, accountAddress };
  }
  return {
    state: 'blocked',
    code: 'OWNER_MISMATCH',
    message: 'The name is owned by a different address; ownership is inconclusive.',
    name: checked.name,
    accountAddress
  };
}
