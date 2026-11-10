import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileJson, FolderOpen, Play, RefreshCw, Send, ShieldAlert, Square, SquareCheckBig, XCircle } from 'lucide-react';
import {
  MAX_BATCH_RESOURCES,
  buildFolderMap,
  buildFolderMapFromZip,
  orderResources,
  planBatches,
  sha256Bytes,
  validateHandoffPackage,
  type HandoffManifest,
  type HandoffResource,
  type PublicationState,
  type ValidatedHandoff
} from './handoff';
import {
  bridgeDiagnostics,
  fetchQdnBase64,
  getActiveAccount,
  getOwnedNames,
  getResourceProperties,
  getQortalRequest,
  getResourceStatus,
  requestQortal
} from './bridge';
import type { OwnedName } from './ownership';
import { preselectTargetName, resolveTargetGate, targetPhaseMessage } from './targetState';
import { createReceipt, downloadReceipt, receiptFileText, type ReceiptDocument } from './receipt';
import { APP_VERSION } from '../version';
import { PublisherUpdate } from './PublisherUpdate';

interface ResourceState {
  status: PublicationState;
  reason: string;
  txSignature: string | null;
  updatedAt: string;
  verification?: Record<string, unknown> | null;
}

interface SessionState {
  handoffId: string;
  selected: string[];
  states: Record<string, ResourceState>;
  accountAddress: string | null;
  accountName: string | null;
  receipt: ReceiptDocument | null;
  updatedAt: string;
}

const STORAGE_PREFIX = 'qms-migration-publisher-v2:';
const ACTIONS = new Set(['PUBLISH_MULTIPLE_QDN_RESOURCES']);
const STATUS_TONE: Record<string, string> = {
  remote_verified: 'good',
  submitted: 'info',
  pending_confirmation: 'warn',
  ambiguous: 'warn',
  partial: 'warn',
  failed: 'bad',
  declined: 'bad',
  blocked: 'bad'
};

function loadSession(handoffId: string): SessionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + handoffId);
    return raw ? JSON.parse(raw) as SessionState : null;
  } catch {
    return null;
  }
}

function saveSession(session: SessionState) {
  try {
    localStorage.setItem(STORAGE_PREFIX + session.handoffId, JSON.stringify(session));
  } catch {
    // localStorage can be unavailable in hardened webviews; the in-memory
    // session remains authoritative and the receipt is still exportable.
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function statusOf(state: ResourceState | undefined): PublicationState {
  return state?.status ?? 'reserved';
}

function label(value: string): string {
  return value.replace(/_/g, ' ');
}

function tone(value: string): string {
  return STATUS_TONE[value] ?? 'neutral';
}

function resourceFilename(resource: HandoffResource): string {
  return resource.relativePath.split('/').pop() || resource.identifier;
}

function encodePath(value: string): string {
  return String(value).split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function decodeBase64(value: string): Uint8Array {
  const compact = value.replace(/\s+/g, '');
  if (compact !== '' && (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0)) {
    throw new Error('The node returned a non-base64 body; exact hash comparison is not possible.');
  }
  const binary = atob(compact);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Multi-file APP read-back reads each member with ?filepath= and base64. */
async function fetchAppMember(resource: HandoffResource, filepath: string): Promise<Uint8Array> {
  try {
    const bridged = await requestQortal({
      action: 'FETCH_QDN_RESOURCE',
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      filepath,
      encoding: 'base64'
    });
    if (typeof bridged === 'string') return decodeBase64(bridged);
  } catch {
    // A Hub build without filepath support falls back to the node read below.
  }
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const url = base + '/arbitrary/' + encodeURIComponent(resource.service)
    + '/' + encodeURIComponent(resource.name)
    + '/' + encodeURIComponent(resource.identifier)
    + '?filepath=' + encodePath(filepath) + '&encoding=base64';
  const response = await fetch(url, { cache: 'no-store' });
  if (response.status === 401 || response.status === 403) {
    throw new Error('The node refused read access for APP member ' + filepath + '.');
  }
  if (!response.ok) {
    throw new Error('APP member read failed with HTTP ' + response.status + ' for ' + filepath + '.');
  }
  return decodeBase64(await response.text());
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function normalizeStatus(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.status === 'string') return record.status;
  if (typeof record.status === 'number') {
    return ({ 1: 'PUBLISHED', 2: 'NOT_PUBLISHED', 3: 'DOWNLOADING', 4: 'DOWNLOADED', 5: 'BUILDING', 6: 'READY', 7: 'MISSING_DATA', 8: 'BUILD_FAILED', 9: 'UNSUPPORTED', 10: 'BLOCKED' } as Record<number, string>)[record.status] ?? String(record.status);
  }
  return '';
}

function outcomeForError(message: string): PublicationState {
  const text = message.toLowerCase();
  if (text.includes('declin') || text.includes('denied') || text.includes('rejected')) return 'declined';
  return 'ambiguous';
}

async function verifyOne(resource: HandoffResource): Promise<ResourceState> {
  if (resource.service === 'APP' || resource.service === 'WEBSITE') {
    const bundle = resource.metadata?.bundle;
    if (!bundle || !Array.isArray(bundle.files) || bundle.files.length === 0) {
      return {
        status: 'blocked',
        reason: 'This APP resource has no member manifest; exact read-back is impossible.',
        txSignature: null,
        updatedAt: nowIso()
      };
    }
    const verifiedMembers: Array<Record<string, unknown>> = [];
    for (const member of bundle.files) {
      try {
        const bytes = await fetchAppMember(resource, member.path);
        const hash = await sha256Bytes(bytes);
        if (bytes.length !== member.bytes || hash !== member.sha256) {
          return {
            status: 'ambiguous',
            reason: 'APP member bytes do not match: ' + member.path,
            txSignature: null,
            updatedAt: nowIso(),
            verification: { transport: 'http:filepath:base64', path: member.path, expectedBytes: member.bytes, remoteBytes: bytes.length, expectedHash: member.sha256, remoteHash: hash }
          };
        }
        verifiedMembers.push({ path: member.path, bytes: bytes.length, sha256: hash });
      } catch (error) {
        const message = (error as Error).message;
        return {
          status: message.includes('HTTP 404') ? 'pending_confirmation' : 'ambiguous',
          reason: message,
          txSignature: null,
          updatedAt: nowIso()
        };
      }
    }
    return {
      status: 'remote_verified',
      reason: 'Every APP member matches the bundle SHA-256.',
      txSignature: null,
      updatedAt: nowIso(),
      verification: { transport: 'http:filepath:base64', members: verifiedMembers }
    };
  }
  try {
    const bytes = await fetchQdnBase64(resource.service, resource.name, resource.identifier);
    const hash = await sha256Bytes(bytes);
    if (bytes.length !== resource.bytes || hash !== resource.sha256) {
      return {
        status: 'ambiguous',
        reason: 'Read-back bytes do not match this handoff resource.',
        txSignature: null,
        updatedAt: nowIso(),
        verification: {
          transport: 'qortalRequest:FETCH_QDN_RESOURCE:base64',
          expectedBytes: resource.bytes,
          remoteBytes: bytes.length,
          expectedHash: resource.sha256,
          remoteHash: hash
        }
      };
    }
    return {
      status: 'remote_verified',
      reason: 'Exact QDN bytes match the intended SHA-256.',
      txSignature: null,
      updatedAt: nowIso(),
      verification: { transport: 'qortalRequest:FETCH_QDN_RESOURCE:base64', expectedHash: resource.sha256, remoteHash: hash }
    };
  } catch (error) {
    return {
      status: 'pending_confirmation',
      reason: (error as Error).message,
      txSignature: null,
      updatedAt: nowIso()
    };
  }
}

export function PublisherPage({ initialName = '', onBack }: { initialName?: string; onBack?: () => void }) {
  const [folderName, setFolderName] = useState('');
  const [targetName, setTargetName] = useState(initialName);
  const [nameAttempted, setNameAttempted] = useState(false);
  const [validated, setValidated] = useState<ValidatedHandoff | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Record<string, ResourceState>>({});
  const [account, setAccount] = useState<{ address: string; publicKey?: string } | null>(null);
  const [ownedNames, setOwnedNames] = useState<OwnedName[]>([]);
  const [remotePresence, setRemotePresence] = useState<Record<string, 'unknown' | 'new' | 'update' | 'collision'>>({});
  const [allowUpdates, setAllowUpdates] = useState(false);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<ReceiptDocument | null>(null);
  const [sessions, setSessions] = useState<Array<{ handoffId: string; status: string; updatedAt: string }>>([]);
  const [feeQuote, setFeeQuote] = useState<{ atomic: number; qort: number; at: string } | null>(null);
  const running = useRef(false);
  const bridge = getQortalRequest();
  const diagnostics = bridgeDiagnostics();

  useEffect(() => {
    try {
      const rows = Object.keys(localStorage)
        .filter((key) => key.startsWith(STORAGE_PREFIX))
        .map((key) => JSON.parse(localStorage.getItem(key) || '{}') as SessionState)
        .filter((entry) => entry.handoffId)
        .map((entry) => ({
          handoffId: entry.handoffId,
          status: Object.values(entry.states ?? {})[0]?.status ?? 'reserved',
          updatedAt: entry.updatedAt ?? ''
        }));
      setSessions(rows);
    } catch {
      setSessions([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const manifest: HandoffManifest | null = validated?.manifest ?? null;
  const targetGate = resolveTargetGate({
    manifestName: manifest?.target.qdnName ?? null,
    packageLoaded: Boolean(manifest),
    manualName: targetName,
    accountAddress: account?.address ?? null,
    accountConnected: Boolean(account),
    ownedNames,
    attempted: nameAttempted
  });
  const nameOwned = targetGate.canProceed;
  const selectedResources = useMemo(
    () => orderResources(manifest?.resources ?? []).filter((resource) => selected.has(resource.id)),
    [manifest, selected]
  );
  const collisionCount = Object.values(remotePresence).filter((value) => value === 'collision').length;
  const blockedByPrereq = !bridge || !account || !nameOwned;

  function updateState(resourceId: string, next: ResourceState) {
    setStates((current) => {
      const merged = { ...current, [resourceId]: next };
      const handoffId = manifest?.handoffId;
      if (handoffId) {
        saveSession({
          handoffId,
          selected: [...selected],
          states: merged,
          accountAddress: account?.address ?? null,
          accountName: targetName || null,
          receipt,
          updatedAt: nowIso()
        });
      }
      return merged;
    });
  }
  async function chooseFolder(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const isZip = files.length === 1 && /\.zip$/i.test(files[0].name);
    setBusy(true);
    setError(null);
    setNotice('');
    setReceipt(null);
    setValidated(null);
    setRemotePresence({});
    try {
      const map = isZip ? await buildFolderMapFromZip(files[0]) : await buildFolderMap(files);
      const result = await validateHandoffPackage(map);
      setValidated(result);
      setTargetName(result.manifest.target.qdnName);
      setNameAttempted(false);
      setFolderName(isZip ? files[0].name : ((files[0] as File & { webkitRelativePath?: string })?.webkitRelativePath?.split('/')[0] || 'selected folder'));
      const remembered = loadSession(result.manifest.handoffId);
      if (remembered) {
        setStates(remembered.states ?? {});
        setSelected(new Set(remembered.selected ?? result.manifest.resources.map((resource) => resource.id)));
        setReceipt(remembered.receipt ?? null);
        setNotice('Recovered the previous session for this handoff. Nothing is resubmitted automatically.');
      } else {
        setStates(Object.fromEntries(result.manifest.resources.map((resource) => [
          resource.id,
          { status: 'handoff_ready', reason: 'Validated locally; not published.', txSignature: null, updatedAt: nowIso() }
        ])));
        setSelected(new Set(result.manifest.resources.map((resource) => resource.id)));
      }
      saveSession({
        handoffId: result.manifest.handoffId,
        selected: [...(remembered?.selected ?? result.manifest.resources.map((resource) => resource.id))],
        states: remembered?.states ?? {},
        accountAddress: account?.address ?? null,
        accountName: result.manifest.target.qdnName,
        receipt: remembered?.receipt ?? null,
        updatedAt: nowIso()
      });
    } catch (folderError) {
      setError((folderError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function connectAccount() {
    setBusy(true);
    setError(null);
    try {
      const active = await getActiveAccount();
      setAccount(active);
      const names = await getOwnedNames(active.address);
      setOwnedNames(names);
      setTargetName((current) => preselectTargetName({
        manifestName: manifest?.target.qdnName ?? null,
        currentName: current,
        accountConnected: true,
        ownedNames: names
      }));
      setNotice(names.length === 1
        ? 'Active account loaded. Target name preselected from its single owned name; verify it before checking remote state.'
        : 'Active account loaded. ' + (names.length > 1 ? 'Choose the exact owned name from the list.' : 'Enter the exact target Qortal name.'));
    } catch (connectError) {
      setError((connectError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function quoteNetworkFee() {
    setBusy(true);
    setError(null);
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const response = await fetch(base + '/transactions/unitfee?txType=ARBITRARY&timestamp=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('The node did not return an ARBITRARY fee (HTTP ' + response.status + ').');
      const text = (await response.text()).trim();
      const atomic = Number(text);
      if (!Number.isFinite(atomic) || atomic < 0) throw new Error('The node returned an invalid ARBITRARY fee.');
      setFeeQuote({ atomic, qort: atomic / 1e8, at: new Date().toISOString() });
      setNotice('Live network quote loaded. Qortal Hub still shows and approves the authoritative fee.');
    } catch (quoteError) {
      setFeeQuote(null);
      setError('Live fee quote unavailable: ' + (quoteError as Error).message + ' Continue and Qortal Hub will show the fee before approval.');
    } finally {
      setBusy(false);
    }
  }

  async function checkRemoteState() {
    setNameAttempted(true);
    if (!manifest) return;
    if (!targetGate.canProceed) {
      setError(targetGate.warning || 'Verify the exact target name and owning account before checking remote state.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const presence: Record<string, 'unknown' | 'new' | 'update' | 'collision'> = {};
      for (const resource of manifest.resources) {
        try {
          const status = normalizeStatus(await getResourceStatus(resource.service, resource.name, resource.identifier));
          if (!status || status === 'NOT_PUBLISHED' || status === 'MISSING_DATA') {
            presence[resource.id] = 'new';
            continue;
          }
          const properties = await getResourceProperties(resource.service, resource.name, resource.identifier);
          if (properties && Number.isInteger(properties.size)) {
            presence[resource.id] = properties.size === resource.bytes ? 'update' : 'collision';
          } else {
            presence[resource.id] = 'unknown';
          }
        } catch {
          presence[resource.id] = 'unknown';
        }
      }
      setRemotePresence(presence);
      setNotice('Remote state checked. Collisions are updates whose existing byte length differs from this handoff.');
    } catch (checkError) {
      setError((checkError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(resource: HandoffResource) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(resource.id)) {
        next.delete(resource.id);
        // Dependents cannot be selected without their prerequisite.
        for (const candidate of manifest?.resources ?? []) {
          if (candidate.dependsOn.includes(resource.id)) next.delete(candidate.id);
        }
      } else {
        const missing = resource.dependsOn.filter((dependency) => !next.has(dependency));
        if (missing.length > 0) {
          setError('Select dependencies first: ' + missing.join(', '));
          return current;
        }
        next.add(resource.id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set((manifest?.resources ?? []).map((resource) => resource.id)));
  }

  function clearSelected() {
    setSelected(new Set());
  }

  async function runVerification(resource: HandoffResource, attempts = 4): Promise<ResourceState> {
    let last = await verifyOne(resource);
    if (last.status === 'remote_verified' || last.status === 'ambiguous') return last;
    for (let attempt = 1; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      last = await verifyOne(resource);
      if (last.status === 'remote_verified' || last.status === 'ambiguous') return last;
    }
    return last;
  }

  function payloadFor(resource: HandoffResource): Record<string, unknown> {
    const file = validated?.files.get(resource.relativePath);
    if (!file) throw new Error('Missing selected payload: ' + resource.relativePath);
    const title = typeof resource.metadata?.title === 'string' ? resource.metadata.title : resource.identifier;
    if (resource.service === 'APP' || resource.service === 'WEBSITE') {
      const filename = resource.identifier + '.zip';
      const body = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
      return {
        name: resource.name,
        service: resource.service,
        identifier: resource.identifier,
        file: new File([body], filename, { type: 'application/zip' }),
        filename,
        isMultiFileZip: true,
        title,
        description: 'Qortal Migration Studio website bundle ' + (manifest?.handoffId ?? '')
      };
    }
    if (resource.service === 'DOCUMENT' || resource.service === 'JSON') {
      return {
        name: resource.name,
        service: resource.service,
        identifier: resource.identifier,
        data64: bytesToBase64(file.bytes),
        encoding: 'base64',
        title,
        description: 'Qortal Migration Studio handoff ' + manifest?.handoffId
      };
    }
    const filename = resourceFilename(resource);
    const body = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
    return {
      name: resource.name,
      service: resource.service,
      identifier: resource.identifier,
      file: new File([body], filename, { type: resource.contentType }),
      filename,
      title,
      description: 'Qortal Migration Studio handoff ' + manifest?.handoffId
    };
  }

  async function publishSelected() {
    setNameAttempted(true);
    if (!manifest || !validated || !account || !nameOwned || !approved || running.current) return;
    if (collisionCount > 0 && !allowUpdates) {
      setError('Resolve the ' + collisionCount + ' existing-resource collision(s) before publishing.');
      return;
    }
    running.current = true;
    setBusy(true);
    setError(null);
    setNotice('Checking which selected resources are already available with exact bytes…');
    const outcome: Record<string, ResourceState> = { ...states };
    const persist = () => {
      saveSession({
        handoffId: manifest.handoffId,
        selected: [...selected],
        states: outcome,
        accountAddress: account.address,
        accountName: targetName,
        receipt,
        updatedAt: nowIso()
      });
    };
    const setOutcome = (resourceId: string, next: ResourceState) => {
      outcome[resourceId] = next;
      setStates((current) => ({ ...current, [resourceId]: next }));
      persist();
    };
    try {
      const verified = new Set<string>();
      const collisions = new Set<string>();
      const blockedRetry = new Set<string>();
      for (const resource of selectedResources) {
        const prior = statusOf(outcome[resource.id]);
        if (prior === 'remote_verified') {
          verified.add(resource.id);
          continue;
        }
        const result = await runVerification(resource, 2);
        if (result.status === 'remote_verified') {
          setOutcome(resource.id, { ...result, reason: 'Already present with exact bytes; publication skipped.' });
          verified.add(resource.id);
        } else if (['submitted', 'pending_confirmation', 'ambiguous'].includes(prior)) {
          blockedRetry.add(resource.id);
          setOutcome(resource.id, {
            status: 'blocked',
            reason: 'An earlier attempt has no confirmed outcome. Reconcile it before any retry; ambiguous writes are never resubmitted automatically.',
            txSignature: outcome[resource.id]?.txSignature ?? null,
            updatedAt: nowIso(),
            verification: result.verification ?? null
          });
        } else if (result.status === 'ambiguous') {
          collisions.add(resource.id);
          if (!allowUpdates) {
            setOutcome(resource.id, {
              status: 'blocked',
              reason: 'Existing remote bytes differ from this handoff. Authorize updates explicitly or resolve the collision.',
              txSignature: null,
              updatedAt: nowIso(),
              verification: result.verification ?? null
            });
          }
        }
      }
      if (collisions.size > 0 && !allowUpdates) {
        throw new Error('Publishing blocked: ' + collisions.size + ' existing resource(s) have different bytes. No resource was submitted.');
      }
      const pendingSelected = selectedResources.filter((resource) => !verified.has(resource.id) && !blockedRetry.has(resource.id));
      const batches = planBatches(manifest.resources, new Set(pendingSelected.map((resource) => resource.id)));
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        const ready = batch.filter((resource) =>
          resource.dependsOn.every((dependency) => verified.has(dependency) || !selected.has(dependency))
        );
        const blocked = batch.filter((resource) => !ready.includes(resource));
        for (const resource of blocked) {
          setOutcome(resource.id, {
            status: 'blocked',
            reason: 'A dependency is not remotely verified; this resource was not submitted.',
            txSignature: null,
            updatedAt: nowIso()
          });
        }
        if (ready.length === 0) continue;
        setNotice('Publishing batch ' + (batchIndex + 1) + ' of ' + batches.length + ' (' + ready.length + ' resources, maximum ' + MAX_BATCH_RESOURCES + '). Qortal Hub will ask for approval.');
        let response: unknown = null;
        let thrown: string | null = null;
        try {
          response = await requestQortal({
            action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
            resources: ready.map(payloadFor)
          });
        } catch (publishError) {
          thrown = (publishError as Error).message;
        }
        const submittedAt = nowIso();
        if (thrown) {
          for (const resource of ready) {
            setOutcome(resource.id, {
              status: outcomeForError(thrown),
              reason: thrown,
              txSignature: null,
              updatedAt: nowIso()
            });
          }
        } else if (Array.isArray(response)) {
          for (const [index, resource] of ready.entries()) {
            const entry = response[index] as Record<string, unknown> | undefined;
            setOutcome(resource.id, {
              status: 'submitted',
              reason: 'Hub returned a resource response; exact read-back is pending.',
              txSignature: typeof entry?.signature === 'string' ? entry.signature : null,
              updatedAt: nowIso()
            });
          }
        } else {
          const failures = (response as { error?: { unsuccessfulPublishes?: Array<Record<string, unknown>> } })?.error?.unsuccessfulPublishes ?? [];
          const failureById = new Map(failures.map((entry) => [String(entry.identifier ?? ''), entry]));
          for (const resource of ready) {
            const failure = failureById.get(resource.identifier);
            if (failure) {
              const reason = String(failure.reason ?? 'Qortal reported an unsuccessful publish.');
              setOutcome(resource.id, {
                status: outcomeForError(reason),
                reason,
                txSignature: null,
                updatedAt: submittedAt
              });
            } else {
              setOutcome(resource.id, {
                status: 'ambiguous',
                reason: 'Qortal returned a partial response without a success entry; exact read-back decides.',
                txSignature: null,
                updatedAt: submittedAt
              });
            }
          }
        }

        for (const resource of ready) {
          const current = outcome[resource.id];
          if (current?.status === 'failed' || current?.status === 'declined') continue;
          const verification = await runVerification(resource, 5);
          setOutcome(resource.id, {
            ...verification,
            txSignature: current?.txSignature ?? null,
            updatedAt: nowIso()
          });
          if (verification.status === 'remote_verified') verified.add(resource.id);
        }

        const unfinished = ready.some((resource) => {
          const status = statusOf(outcome[resource.id]);
          return status === 'pending_confirmation' || status === 'ambiguous' || status === 'failed';
        });
        if (unfinished) {
          setNotice('Batch paused for reconciliation. Nothing is automatically resubmitted; resume after reviewing the ambiguous, pending or failed resources.');
          break;
        }
      }

      const attempted = selectedResources.filter((resource) => outcome[resource.id] && outcome[resource.id].status !== 'handoff_ready');
      if (attempted.length > 0) {
        const generated = await createReceipt({
          handoff: manifest,
          accountAddress: account.address,
          accountName: targetName,
          appVersion: APP_VERSION,
          createdAt: nowIso(),
          results: attempted.map((resource) => ({
            resourceId: resource.id,
            service: resource.service,
            name: resource.name,
            identifier: resource.identifier,
            status: outcome[resource.id].status,
            reason: outcome[resource.id].reason,
            txSignature: outcome[resource.id].txSignature,
            submittedAt: outcome[resource.id].updatedAt,
            confirmedAt: outcome[resource.id].status === 'remote_verified' ? outcome[resource.id].updatedAt : null,
            verification: outcome[resource.id].verification ?? null
          }))
        });
        setReceipt(generated);
        saveSession({
          handoffId: manifest.handoffId,
          selected: [...selected],
          states: outcome,
          accountAddress: account.address,
          accountName: targetName,
          receipt: generated,
          updatedAt: nowIso()
        });
        setNotice('Receipt generated. Import it into Qortal Migration Studio for independent read-back verification.');
      }
    } catch (publishFailure) {
      setError((publishFailure as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
      setApproved(false);
    }
  }

  async function copyReceipt() {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receiptFileText(receipt));
      setNotice('Receipt JSON copied to the clipboard.');
    } catch {
      setError('Clipboard access is unavailable; use Save receipt.');
    }
  }

  return (
    <main className="publisher-shell">
      <section className="publisher-header">
        {onBack && (
          <button type="button" className="back-button" onClick={onBack}>
            Back to preview
          </button>
        )}
        <p className="eyebrow">Universal QDN publication</p>
        <h1>Migration Publisher</h1>
        <p className="version-line">Version {APP_VERSION}</p>
        <PublisherUpdate />
        <div className="publisher-controls">
          <label>
            Handoff folder
            <input
              type="file"
              multiple
              // Chromium folder picker used by Qortal Hub.
              {...{ webkitdirectory: '', directory: '' }}
              onChange={(event) => void chooseFolder(event)}
              disabled={busy}
            />
          </label>
          <label>
            Publisher package (.zip)
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => void chooseFolder(event)}
              disabled={busy}
            />
          </label>
          <button type="button" disabled={busy || !bridge} onClick={() => void connectAccount()}>
            <ShieldAlert size={17} />
            {account ? 'Refresh active account' : 'Connect Qortal account'}
          </button>
          <button type="button" disabled={busy || !validated || !account} onClick={() => void checkRemoteState()}>
            <RefreshCw size={17} />
            Check remote state
          </button>
        </div>
        <div className={'publisher-state ' + targetGate.phase} role="status" aria-live="polite">
          <strong>{targetGate.phase === 'package-loaded' ? 'Publisher package loaded' : 'Load the Publisher package (.zip)'}</strong>
          <span>{targetGate.phase === 'package-loaded' && manifest
            ? manifest.handoffId + ' · ' + manifest.resources.length + ' resources · target ' + manifest.target.qdnName
            : targetPhaseMessage(targetGate.phase)}</span>
        </div>
        <section className="publisher-name" aria-labelledby="publisher-target-name-label">
          <label id="publisher-target-name-label" htmlFor="publisher-target-name">Target Qortal name</label>
          <div className="publisher-name__row">
            <input
              id="publisher-target-name"
              type="text"
              value={targetName}
              onChange={(event) => setTargetName(event.target.value)}
              placeholder="Exact registered Qortal name"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              list={ownedNames.length > 0 ? 'publisher-owned-names' : undefined}
            />
            {ownedNames.length > 1 && (
              <select
                aria-label="Owned Qortal names"
                value={ownedNames.some((entry) => entry.name === targetName) ? targetName : ''}
                onChange={(event) => setTargetName(event.target.value)}
                disabled={busy}
              >
                <option value="">Choose an owned name…</option>
                {ownedNames.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
              </select>
            )}
          </div>
          <datalist id="publisher-owned-names">
            {ownedNames.map((entry) => <option key={entry.name} value={entry.name} />)}
          </datalist>
          <p className="publisher-note">
            Names are matched exactly (NFKC, no case-folding). A reduced or renamed form is never treated as ownership evidence.
            {targetGate.phase === 'package-loaded' ? ' A loaded package is bound to ' + (manifest?.target.qdnName ?? '') + '.' : ''}
          </p>
        </section>
        <div className="publisher-summary">
          <span>{folderName || 'no package loaded'}</span>
          <span>{manifest ? manifest.resources.length + ' resources' : '—'}</span>
          <span>{selected.size} selected</span>
          <span>{account ? account.address.slice(0, 10) + '…' : 'account not connected'}</span>
          <span>{targetName ? 'target: ' + targetName : 'target name not set'}</span>
        </div>
        {!bridge && (
          <p className="publisher-warning">
            Qortal request API is not available. Open this Q-App in Qortal Hub. Bridge diagnostics: injected={String(diagnostics.injectedGlobal)},
            windowProperty={String(diagnostics.windowProperty)}, secureContext={String(diagnostics.secureContext)}, origin={diagnostics.locationOrigin}
          </p>
        )}
        {targetGate.showValidation && targetGate.ownership.state === 'verified' && !targetGate.boundToPackage && (
          <p className="publisher-ok" role="status">
            <CheckCircle2 size={17} />
            Name ownership verified for {targetGate.name}. Qortal Hub still performs the authoritative check before signing.
          </p>
        )}
        {targetGate.warning && <p className="publisher-warning" role="alert">{targetGate.warning}</p>}
        {error && <p className="publisher-warning">{error}</p>}
        {notice && <p className="publisher-note">{notice}</p>}
      </section>

      {validated && manifest && (
        <>
          <section className="publisher-list">
            <div className="publisher-toolbar">
              <span className="publisher-note">
                Validated {validated.summary.resources} resources and {validated.summary.bytes} bytes. Every payload hash matches handoff.json.
              </span>
              <button type="button" onClick={selectAll}>Select all</button>
              <button type="button" onClick={clearSelected}>Clear</button>
              <label className="publisher-toggle">
                <input type="checkbox" checked={allowUpdates} onChange={(event) => setAllowUpdates(event.target.checked)} />
                Authorize updates to existing resources ({collisionCount} collision{collisionCount === 1 ? '' : 's'})
              </label>
            </div>
            {manifest.cms && (
              <p className={manifest.cms.selection === 'content-only' ? 'publisher-note' : 'publisher-ok'} role="status">
                {manifest.cms.message || (manifest.cms.selection === 'content-only'
                  ? 'CMS omitted by Content only selection.'
                  : 'Generic CMS APP/WEBSITE bundle is included and publishable after its dependencies.')}
              </p>
            )}
            {manifest.resources.map((resource) => {
              const state = states[resource.id];
              const status = statusOf(state);
              const presence = remotePresence[resource.id] ?? 'unknown';
              return (
                <article key={resource.id} className={'publisher-row' + (presence === 'collision' && !allowUpdates ? ' blocked' : '')}>
                  <button type="button" className="row-check" onClick={() => toggle(resource)} disabled={busy}>
                    {selected.has(resource.id) ? <SquareCheckBig size={19} /> : <Square size={19} />}
                  </button>
                  <div>
                    <strong>{resource.kind} · {resource.identifier}</strong>
                    <span>{resource.service} · {resource.bytes} bytes · {resource.contentType} · depends on {resource.dependsOn.length}</span>
                    <span className="publisher-hash">{resource.sha256}</span>
                  </div>
                  <div className={'publisher-status ' + tone(status)}>
                    {status === 'remote_verified' && <CheckCircle2 size={18} />}
                    {status === 'failed' && <XCircle size={18} />}
                    {status === 'submitted' && <Play size={18} />}
                    <span>{label(status)}{state?.reason ? ' · ' + state.reason : ''}</span>
                  </div>
                  <div className="publisher-presence">
                    <span className={'presence presence-' + presence}>{presence}</span>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="publisher-footer">
            <div className="publisher-summary">
              <span>Estimate {manifest.estimate.estimatedFee} {manifest.estimate.currency}</span>
              <span>{Math.ceil(selected.size / MAX_BATCH_RESOURCES)} batch(es)</span>
              <span>{manifest.estimate.label}</span>
              {feeQuote && (
                <span>Live quote: {feeQuote.qort.toFixed(8)} QORT/resource · {selected.size} selected ≈ {(feeQuote.qort * selected.size).toFixed(8)} QORT · {new Date(feeQuote.at).toLocaleTimeString()}</span>
              )}
            </div>
            <button type="button" className="ghost" disabled={busy} onClick={() => void quoteNetworkFee()}>
              Get live network fee quote
            </button>
            <label className="publisher-toggle">
              <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
              I explicitly approve publishing these {selected.size} resources and the Qortal Hub network fee.
            </label>
            <button
              type="button"
              className="publish-button"
              disabled={busy || blockedByPrereq || !approved || selected.size === 0 || (collisionCount > 0 && !allowUpdates)}
              onClick={() => void publishSelected()}
            >
              <Send size={17} />
              {busy ? 'Working…' : 'Approve and publish selected set'}
            </button>
            <p className="publisher-note">
              Signing and fee approval stay inside Qortal Hub. This Publisher never asks for a seed, private key or wallet password.
              A READY status is not proof; each resource becomes verified only after an exact base64 read-back hash matches.
            </p>
          </section>
        </>
      )}

      {receipt && (
        <section className="publisher-receipt">
          <FileJson size={19} />
          <div>
            <strong>Receipt {receipt.receiptId}</strong>
            <span>{receipt.results.length} resource outcomes · {Object.entries(receipt.counts).map(([key, value]) => key + ': ' + value).join(' · ')}</span>
            <span>Import this receipt into Qortal Migration Studio. It is Publisher-reported evidence, not proof of QDN read-back.</span>
          </div>
          <div className="publisher-receipt-actions">
            <button type="button" onClick={() => void downloadReceipt(receipt)}>
              <FolderOpen size={17} />
              Save receipt
            </button>
            <button type="button" onClick={() => void copyReceipt()}>Copy JSON</button>
          </div>
        </section>
      )}

      {sessions.length > 0 && (
        <section className="publisher-history">
          <h2>Previous sessions</h2>
          <p className="publisher-note">Restart recovery is local to this Hub profile. Select the same handoff folder to resume. Nothing is resubmitted automatically.</p>
          <ul>
            {sessions.slice(0, 10).map((session) => (
              <li key={session.handoffId}><code>{session.handoffId}</code> · {session.status} · {session.updatedAt}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="publisher-help">
        <h2>Variant A workflow</h2>
        <ol>
          <li>Qortal Migration Studio prepares one portable Publisher package (.zip) with exact bytes and SHA-256 hashes.</li>
          <li>Open Qortal Hub → Apps → Migration Publisher and select that .zip (or the whole handoff folder).</li>
          <li>Connect the active account and confirm it owns the target Qortal name.</li>
          <li>Review resources, dependencies and existing-resource collisions; explicitly approve the set.</li>
          <li>Hub approves and signs each batch. This Publisher publishes at most {MAX_BATCH_RESOURCES} resources per request and stops on ambiguous or pending results.</li>
          <li>If the package includes a Generic CMS site, the Publisher publishes it as a multi-file APP or WEBSITE bundle and verifies every member after publishing.</li>
          <li>Save the receipt, import it into Migration Studio, then run independent QDN read-back verification there.</li>
        </ol>
      </section>
    </main>
  );
}
