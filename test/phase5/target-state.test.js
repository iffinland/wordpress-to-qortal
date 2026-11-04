import test from 'node:test';
import assert from 'node:assert/strict';
import { preselectTargetName, resolveTargetGate } from '../../viewer/src/publisher/targetState.ts';

const ACCOUNT = 'QOwnerAddress111111111111111111111';
const OTHER_ACCOUNT = 'QOtherAddress222222222222222222222';
const OWNED = [{ name: 'Developer Iffi', owner: ACCOUNT }];

function gate(overrides = {}) {
  return resolveTargetGate({
    manifestName: null,
    packageLoaded: false,
    manualName: '',
    accountAddress: ACCOUNT,
    accountConnected: true,
    ownedNames: OWNED,
    attempted: false,
    ...overrides
  });
}

test('an empty target name is not reported before a package is loaded', () => {
  const resolved = gate();
  assert.equal(resolved.ownership.code, 'TARGET_NAME_REQUIRED');
  assert.equal(resolved.showValidation, false);
  assert.equal(resolved.warning, '');
  assert.equal(resolved.canProceed, false);
});

test('an empty target name is reported only after an explicit check attempt', () => {
  const resolved = gate({ attempted: true });
  assert.equal(resolved.showValidation, true);
  assert.equal(resolved.warning, 'A target Qortal name is required.');
});

test('the loaded handoff name is prefilled and verifies exact ownership', () => {
  const resolved = gate({
    manifestName: 'Developer Iffi',
    packageLoaded: true,
    manualName: 'Developer Iffi'
  });
  assert.equal(resolved.phase, 'package-loaded');
  assert.equal(resolved.ownership.state, 'verified');
  assert.equal(resolved.boundToPackage, false);
  assert.equal(resolved.canProceed, true);
  assert.equal(resolved.warning, '');
});

test('a loaded package remains bound to its exact target name', () => {
  const resolved = gate({
    manifestName: 'Developer Iffi',
    packageLoaded: true,
    manualName: 'Another Name',
    ownedNames: [...OWNED, { name: 'Another Name', owner: ACCOUNT }]
  });
  assert.equal(resolved.ownership.state, 'verified');
  assert.equal(resolved.boundToPackage, true);
  assert.equal(resolved.canProceed, false);
  assert.match(resolved.warning, /bound to "Developer Iffi"/);
});

test('case-folded or owner-mismatched names are never ownership evidence', () => {
  const folded = gate({ packageLoaded: true, manifestName: 'developer iffi', manualName: 'developer iffi' });
  assert.equal(folded.ownership.state, 'blocked');
  assert.equal(folded.canProceed, false);

  const wrongOwner = gate({
    packageLoaded: true,
    manifestName: 'Developer Iffi',
    manualName: 'Developer Iffi',
    ownedNames: [{ name: 'Developer Iffi', owner: OTHER_ACCOUNT }]
  });
  assert.equal(wrongOwner.ownership.state, 'blocked');
  assert.equal(wrongOwner.ownership.code, 'OWNER_MISMATCH');
  assert.equal(wrongOwner.canProceed, false);
});

test('preselection uses a single owned name but never overwrites manual input', () => {
  assert.equal(preselectTargetName({
    manifestName: null,
    currentName: '',
    accountConnected: true,
    ownedNames: OWNED
  }), 'Developer Iffi');

  assert.equal(preselectTargetName({
    manifestName: null,
    currentName: '',
    accountConnected: true,
    ownedNames: [...OWNED, { name: 'Another Name', owner: ACCOUNT }]
  }), '');

  assert.equal(preselectTargetName({
    manifestName: null,
    currentName: 'Typed Name',
    accountConnected: true,
    ownedNames: OWNED
  }), 'Typed Name');

  assert.equal(preselectTargetName({
    manifestName: 'Package Name',
    currentName: 'Typed Name',
    accountConnected: true,
    ownedNames: OWNED
  }), 'Package Name');
});
