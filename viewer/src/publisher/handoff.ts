import { unzipSync } from 'fflate';
import { checkQortalName } from './name.ts';

export const HANDOFF_SCHEMA = 'qms-publication-handoff@1';
export const HANDOFF_VERSION = 1;
export const RECEIPT_SCHEMA = 'qms-publication-receipt@1';
export const RECEIPT_VERSION = 1;
export const MAX_BATCH_RESOURCES = 20;
export const PUBLISHABLE_SERVICES = ['DOCUMENT', 'JSON', 'IMAGE', 'AUDIO', 'VIDEO', 'FILE', 'APP', 'WEBSITE'];
export const BUNDLE_SERVICES = ['APP', 'WEBSITE'];
export const KIND_PHASE: Record<string, number> = { media: 10, content: 20, index: 30, manifest: 40, site: 50 };
export const CMS_BUNDLE_SCHEMA = 'qms-cms-bundle@1';
export const MAX_ZIP_BYTES = 512 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 12000;
export const PUBLICATION_STATES = [
  'reserved', 'prepared', 'handoff_ready', 'submitted', 'pending_confirmation',
  'remote_verified', 'failed', 'partial', 'ambiguous', 'declined', 'blocked'
] as const;

export type PublicationState = typeof PUBLICATION_STATES[number];

export interface BundleMember {
  path: string;
  bytes: number;
  sha256: string;
  contentType?: string;
}

export interface BundleMetadata {
  schema: string;
  format: 'zip';
  entrypoint: 'index.html';
  files: BundleMember[];
}

export interface HandoffResource {
  id: string;
  kind: 'media' | 'content' | 'index' | 'manifest' | 'site';
  service: string;
  name: string;
  identifier: string;
  relativePath: string;
  contentType: string;
  bytes: number;
  sha256: string;
  order: number;
  dependsOn: string[];
  sourceKey?: string | null;
  metadata?: Record<string, unknown> & { bundle?: BundleMetadata };
}

export interface HandoffManifest {
  schema: string;
  version: number;
  handoffId: string;
  publicationBatchId: string;
  planId: string;
  projectId: string;
  siteId: string;
  siteNamespace: string;
  createdAt: string;
  target: { qdnName: string; resourcePrefix: string };
  publisher?: Record<string, unknown>;
  estimate: {
    resourceCount: number;
    feePerResource: number;
    estimatedFee: number;
    currency: string;
    label: string;
    batches: number;
  };
  resources: HandoffResource[];
  integrity: { algorithm: string; value: string };
}

export interface PackageFile {
  path: string;
  file: File;
  bytes: Uint8Array;
}

export interface ValidatedHandoff {
  manifest: HandoffManifest;
  files: Map<string, PackageFile>;
  summary: {
    resources: number;
    bytes: number;
    counts: Record<string, number>;
  };
}

function fail(message: string): never {
  throw new Error(message);
}

/** Deterministic JSON matching the engine's stableStringify. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === 'number' || typeof input === 'boolean' || typeof input === 'string') return input;
    if (input === undefined) return undefined;
    if (typeof input === 'bigint') return String(input);
    if (typeof input !== 'object') return String(input);
    if (seen.has(input)) fail('Cannot canonicalize a cyclic value.');
    seen.add(input);
    let output: unknown;
    if (Array.isArray(input)) {
      output = input.map(normalize).filter((entry) => entry !== undefined);
    } else {
      output = {};
      for (const key of Object.keys(input).sort()) {
        const normalized = normalize((input as Record<string, unknown>)[key]);
        if (normalized !== undefined) (output as Record<string, unknown>)[key] = normalized;
      }
    }
    seen.delete(input);
    return output;
  };
  return JSON.stringify(normalize(value));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    fail('Web Crypto is unavailable; refusing to prepare or verify hashes.');
  }
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', body);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  return 'sha256:' + await sha256Hex(bytes);
}

export async function integrityOf(document: Record<string, unknown>): Promise<string> {
  const clone = { ...document };
  delete clone.integrity;
  return sha256Bytes(new TextEncoder().encode(stableStringify(clone)));
}

export async function verifyIntegrity(document: Record<string, unknown>, label: string): Promise<void> {
  const integrity = document.integrity as Record<string, unknown> | undefined;
  if (!integrity || integrity.algorithm !== 'sha256') fail(label + ' has no SHA-256 integrity block.');
  const expected = await integrityOf(document);
  if (integrity.value !== expected) fail(label + ' integrity check failed.');
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' must be an object.');
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string, pattern?: RegExp, max = 2000): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(label + ' is invalid.');
  if (pattern && !pattern.test(value)) fail(label + ' has an invalid format.');
  return value;
}

function assertQortalName(value: unknown, label: string): string {
  const checked = checkQortalName(value);
  if (!checked.ok) fail(label + ': ' + checked.message);
  return checked.name;
}

function assertInteger(value: unknown, label: string, min = 0, max = 20 * 1024 * 1024 * 1024): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(label + ' is invalid.');
  return value as number;
}

export function normalizeFolderPath(file: File): string {
  const raw = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = raw.split('/');
  // A directory picker prefixes the selected folder name. The handoff root is
  // the selected folder itself, so strip exactly one prefix segment.
  if (parts.length > 1) return parts.slice(1).join('/');
  return raw;
}

export function assertSafePath(value: string): void {
  if (value.includes('\\') || value.includes('\u0000') || value.startsWith('/') || value.startsWith('~')) {
    fail('Unsafe relative path: ' + value);
  }
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) fail('Unsafe path segments: ' + value);
  if (!value.startsWith('payload/')) fail('Resource path must stay inside payload/: ' + value);
}

function normalizeZipPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized === '' || normalized.includes('\u0000')) fail('The ZIP package contains an invalid path.');
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) fail('The ZIP package contains an unsafe path: ' + value);
  return normalized;
}

export async function buildFolderMapFromZip(file: File): Promise<Map<string, PackageFile>> {
  if (!file || file.size > MAX_ZIP_BYTES) {
    fail('The ZIP package is larger than ' + Math.round(MAX_ZIP_BYTES / (1024 * 1024)) + ' MB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    fail('The selected file is not a readable ZIP package. Export the Publisher package from Migration Studio or select the handoff folder.');
  }
  const paths = Object.keys(entries).filter((entry) => !entry.endsWith('/'));
  if (paths.length === 0) fail('The ZIP package is empty.');
  if (paths.length > MAX_ZIP_ENTRIES) fail('The ZIP package contains too many files.');
  let total = 0;
  const normalized = new Map<string, Uint8Array>();
  for (const entry of paths) {
    const relative = normalizeZipPath(entry);
    const value = entries[entry];
    total += value.length;
    if (total > MAX_ZIP_BYTES) fail('The ZIP package expands beyond the safety limit.');
    if (normalized.has(relative)) fail('The ZIP package contains a duplicate path: ' + relative);
    normalized.set(relative, value);
  }
  // A ZIP may preserve the selected folder as a single root segment.
  let rootPrefix = '';
  if (!normalized.has('handoff.json')) {
    const roots = new Set([...normalized.keys()].map((entry) => entry.split('/')[0]));
    if (roots.size === 1) {
      const only = [...roots][0];
      if (normalized.has(only + '/handoff.json')) rootPrefix = only + '/';
    }
  }
  const map = new Map<string, PackageFile>();
  for (const [path, value] of normalized) {
    const relative = rootPrefix && path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path;
    if (relative === '') continue;
    const body = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
    map.set(relative, { path: relative, bytes: value, file: new File([body], relative.split('/').pop() || 'payload', { type: 'application/octet-stream' }) });
  }
  return map;
}

export async function buildFolderMap(files: File[]): Promise<Map<string, PackageFile>> {
  const map = new Map<string, PackageFile>();
  for (const file of files) {
    const relative = normalizeFolderPath(file);
    if (map.has(relative)) fail('Duplicate file path in selected folder: ' + relative);
    map.set(relative, { path: relative, file, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return map;
}

export async function validateHandoffPackage(files: Map<string, PackageFile>): Promise<ValidatedHandoff> {
  const entry = files.get('handoff.json');
  if (!entry) fail('Selected folder does not contain handoff.json. Select the whole handoff folder.');
  let manifest: HandoffManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(entry.bytes)) as HandoffManifest;
  } catch {
    fail('handoff.json is not valid JSON.');
  }
  const record = assertObject(manifest, 'handoff');
  if (record.schema !== HANDOFF_SCHEMA) fail('Unsupported handoff schema: ' + String(record.schema));
  if (record.version !== HANDOFF_VERSION) fail('Unsupported handoff version: ' + String(record.version));
  await verifyIntegrity(record, 'handoff');
  assertString(record.handoffId, 'handoffId', /^hof_[a-z0-9]{8,40}$/);
  assertString(record.publicationBatchId, 'publicationBatchId', /^pub_[a-z0-9]{8,40}$/);
  assertString(record.planId, 'planId', /^plan_[a-z0-9]{8,40}$/);
  assertString(record.projectId, 'projectId', /^prj_[a-z0-9][a-z0-9-]{3,47}$/);
  assertString(record.siteId, 'siteId', /^site_[a-z0-9]{16,64}$/);
  assertString(record.siteNamespace, 'siteNamespace', /^ns[a-z2-7]{8,40}$/);
  const target = assertObject(record.target, 'target');
  const targetName = assertQortalName(target.qdnName, 'target.qdnName');
  const estimate = assertObject(record.estimate, 'estimate');
  assertString(estimate.label, 'estimate.label', undefined, 160);
  const resourcesValue = record.resources;
  if (!Array.isArray(resourcesValue) || resourcesValue.length === 0) fail('handoff.resources is empty.');
  if (resourcesValue.length > 10000) fail('handoff.resources is too large.');
  assertInteger(estimate.resourceCount, 'estimate.resourceCount', 1, 10000);
  if (estimate.resourceCount !== resourcesValue.length) fail('estimate.resourceCount does not match resources.');
  const resources: HandoffResource[] = [];
  const ids = new Set<string>();
  const triples = new Set<string>();
  const counts: Record<string, number> = {};
  let totalBytes = 0;
  for (const [index, value] of resourcesValue.entries()) {
    const resource = assertObject(value, 'resource[' + index + ']');
    const id = assertString(resource.id, 'resource.id', /^res_[a-z0-9]{8,40}$/);
    if (ids.has(id)) fail('Duplicate resource id: ' + id);
    ids.add(id);
    const kind = String(resource.kind ?? '');
    if (!(kind in KIND_PHASE)) fail('Unsupported resource kind: ' + kind);
    const service = assertString(resource.service, 'resource.service', undefined, 20);
    if (!PUBLISHABLE_SERVICES.includes(service)) fail('Unsupported service: ' + service);
    if (BUNDLE_SERVICES.includes(service) && kind !== 'site') fail('Application bundles must use the site kind.');
    if (kind === 'site' && !BUNDLE_SERVICES.includes(service)) fail('The site resource must use the APP or WEBSITE service.');
    let bundle: BundleMetadata | null = null;
    if (BUNDLE_SERVICES.includes(service)) {
      const metadata = assertObject(resource.metadata, 'resource.metadata');
      bundle = assertObject(metadata.bundle, 'resource.metadata.bundle') as unknown as BundleMetadata;
      if (bundle.schema !== CMS_BUNDLE_SCHEMA) fail('Unsupported CMS bundle schema.');
      if (bundle.format !== 'zip' || bundle.entrypoint !== 'index.html') fail('The CMS bundle must be a ZIP with index.html.');
      if (!Array.isArray(bundle.files) || bundle.files.length === 0) fail('The CMS bundle member list is empty.');
      const memberPaths = new Set<string>();
      for (const member of bundle.files) {
        const memberPath = assertString(member.path, 'bundle.path', /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._@+/\/-]+$/, 300);
        if (memberPaths.has(memberPath)) fail('Duplicate CMS bundle member: ' + memberPath);
        memberPaths.add(memberPath);
        assertInteger(member.bytes, 'bundle.bytes', 0, MAX_ZIP_BYTES);
        assertString(member.sha256, 'bundle.sha256', /^sha256:[a-f0-9]{64}$/);
      }
      if (!memberPaths.has('index.html')) fail('The CMS bundle has no index.html.');
    }
    const name = assertQortalName(resource.name, 'resource.name');
    if (name !== targetName) fail('Resource name does not match the handoff target name.');
    const identifier = assertString(resource.identifier, 'resource.identifier', /^[a-z0-9][a-z0-9_-]{0,63}$/);
    const triple = service + '|' + name + '|' + identifier;
    if (triples.has(triple)) fail('Duplicate QDN triple: ' + triple);
    triples.add(triple);
    const relativePath = assertString(resource.relativePath, 'resource.relativePath', undefined, 500);
    assertSafePath(relativePath);
    const contentType = assertString(resource.contentType, 'resource.contentType', undefined, 200);
    const bytes = assertInteger(resource.bytes, 'resource.bytes');
    const sha256 = assertString(resource.sha256, 'resource.sha256', /^sha256:[a-f0-9]{64}$/);
    const order = assertInteger(resource.order, 'resource.order', 0, 1000000);
    if (!Array.isArray(resource.dependsOn) || resource.dependsOn.some((entry) => typeof entry !== 'string')) {
      fail('resource.dependsOn must be an array of resource ids.');
    }
    if ((resource.dependsOn as string[]).includes(id)) fail('Resource cannot depend on itself.');
    const file = files.get(relativePath);
    if (!file) fail('Missing payload file for ' + id + ': ' + relativePath);
    if (file.bytes.length !== bytes) fail('Payload byte length mismatch for ' + id + '.');
    const actual = await sha256Bytes(file.bytes);
    if (actual !== sha256) fail('Payload SHA-256 mismatch for ' + id + '.');
    if (bundle) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(file.bytes);
      } catch {
        fail('The CMS bundle is not a readable ZIP archive.');
      }
      const members = Object.keys(entries).filter((entry) => !entry.endsWith('/')).sort();
      const expected = bundle.files.slice().sort((left, right) => left.path.localeCompare(right.path));
      if (members.length !== expected.length) fail('The CMS bundle file set does not match its manifest.');
      for (const member of expected) {
        const body = entries[member.path];
        if (!body) fail('The CMS bundle is missing ' + member.path + '.');
        if (body.length !== member.bytes) fail('CMS bundle byte length mismatch: ' + member.path + '.');
        if (await sha256Bytes(body) !== member.sha256) fail('CMS bundle SHA-256 mismatch: ' + member.path + '.');
      }
    }
    totalBytes += bytes;
    counts[kind] = (counts[kind] ?? 0) + 1;
    resources.push({
      id,
      kind: kind as HandoffResource['kind'],
      service,
      name,
      identifier,
      relativePath,
      contentType,
      bytes,
      sha256,
      order,
      dependsOn: resource.dependsOn as string[],
      sourceKey: typeof resource.sourceKey === 'string' ? resource.sourceKey : null,
      metadata: (resource.metadata && typeof resource.metadata === 'object') ? resource.metadata as Record<string, unknown> : {}
    });
  }
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  for (const resource of resources) {
    for (const dependency of resource.dependsOn) {
      const targetResource = byId.get(dependency);
      if (!targetResource) fail('Unknown dependency ' + dependency + ' for ' + resource.id + '.');
      if (KIND_PHASE[targetResource.kind] > KIND_PHASE[resource.kind]) fail('Dependency order is invalid for ' + resource.id + '.');
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (resource: HandoffResource) => {
    if (visited.has(resource.id)) return;
    if (visiting.has(resource.id)) fail('Dependency cycle at ' + resource.id + '.');
    visiting.add(resource.id);
    resource.dependsOn.forEach((dependency) => visit(byId.get(dependency)!));
    visiting.delete(resource.id);
    visited.add(resource.id);
  };
  resources.forEach(visit);
  const manifestValue = {
    ...(record as unknown as HandoffManifest),
    resources
  };
  return {
    manifest: manifestValue,
    files,
    summary: { resources: resources.length, bytes: totalBytes, counts }
  };
}

export function orderResources(resources: HandoffResource[]): HandoffResource[] {
  return resources.slice().sort((left, right) => {
    const phase = (KIND_PHASE[left.kind] ?? 99) - (KIND_PHASE[right.kind] ?? 99);
    if (phase !== 0) return phase;
    if (left.order !== right.order) return left.order - right.order;
    return left.id.localeCompare(right.id);
  });
}

export function planBatches(resources: HandoffResource[], selectedIds: Set<string>, maxBatch = MAX_BATCH_RESOURCES): HandoffResource[][] {
  const selected = orderResources(resources.filter((resource) => selectedIds.has(resource.id)));
  const byId = new Map(selected.map((resource) => [resource.id, resource]));
  const completed = new Set<string>();
  const batches: HandoffResource[][] = [];
  let remaining = selected;
  while (remaining.length > 0) {
    const batch: HandoffResource[] = [];
    const deferred: HandoffResource[] = [];
    for (const resource of remaining) {
      if (batch.length >= maxBatch) {
        deferred.push(resource);
        continue;
      }
      const dependencies = resource.dependsOn.filter((dependency) => byId.has(dependency));
      if (dependencies.every((dependency) => completed.has(dependency))) batch.push(resource);
      else deferred.push(resource);
    }
    if (batch.length === 0) fail('Dependency graph cannot be scheduled.');
    batch.forEach((resource) => completed.add(resource.id));
    batches.push(batch);
    remaining = deferred;
  }
  return batches;
}
