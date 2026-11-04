import { evaluateNameOwnership, type OwnedName, type OwnershipResult } from './ownership.ts';

export type TargetPhase = 'no-package' | 'package-loaded';

export interface TargetGateInput {
  /** Exact qdnName declared by the loaded handoff package, or null. */
  manifestName: string | null;
  packageLoaded: boolean;
  /** The exact text in the Target Qortal name field. Never reduced or case-folded. */
  manualName: string;
  accountAddress: string | null;
  accountConnected: boolean;
  ownedNames: OwnedName[];
  /** True after the user explicitly attempts a remote check or publish. */
  attempted: boolean;
}

export interface TargetGate {
  phase: TargetPhase;
  name: string;
  ownership: OwnershipResult;
  /** Ownership and required-name warnings are only surfaced after a package is
   * loaded or the user explicitly attempts a check/submit. */
  showValidation: boolean;
  /** A loaded package binds its resources to manifest.target.qdnName; editing
   * the field to another name cannot retarget those resources. */
  boundToPackage: boolean;
  /** The exact-name, exact-owner gate for remote checks and publishing. */
  canProceed: boolean;
  warning: string;
}

export function preselectTargetName(input: {
  manifestName?: string | null;
  currentName: string;
  accountConnected: boolean;
  ownedNames: OwnedName[];
}): string {
  if (input.manifestName) return input.manifestName;
  if (String(input.currentName || '').trim() !== '') return input.currentName;
  if (input.accountConnected && input.ownedNames.length === 1) return input.ownedNames[0].name;
  return '';
}

export function resolveTargetGate(input: TargetGateInput): TargetGate {
  const name = String(input.manualName ?? '');
  const ownership = evaluateNameOwnership({
    targetName: name,
    accountAddress: input.accountAddress,
    ownedNames: input.ownedNames
  });
  const showValidation = input.packageLoaded || input.attempted;
  const boundToPackage = input.packageLoaded
    && Boolean(input.manifestName)
    && name !== input.manifestName;
  const canProceed = !boundToPackage && ownership.state === 'verified';
  let warning = '';
  if (showValidation) {
    if (boundToPackage) {
      warning = 'The loaded package is bound to "' + input.manifestName
        + '". Its resources publish under that exact name; restore it before checking or publishing.';
    } else if (ownership.state !== 'verified') {
      warning = ownership.message;
    }
  }
  return {
    phase: input.packageLoaded ? 'package-loaded' : 'no-package',
    name,
    ownership,
    showValidation,
    boundToPackage,
    canProceed,
    warning
  };
}

export function targetPhaseMessage(phase: TargetPhase): string {
  return phase === 'package-loaded'
    ? 'Package loaded. Verify the exact target name and the owning account before checking remote state.'
    : 'Load the Publisher package (.zip) exported by Qortal Migration Studio to begin.';
}
