import { IPC } from './channels.js';
import { checkQortalName } from './qortalName.js';
import { WIZARD_STATE_VERSION, migrateWizardForLoad, normalizeCompletedSteps } from './wizard.js';

export class IpcValidationError extends Error {
  code = 'IPC_INVALID_INPUT';
  constructor(message: string) {
    super(message);
    this.name = 'IpcValidationError';
  }
}

const PROJECT_ID = /^prj_[a-z0-9][a-z0-9-]{3,47}$/;
const PLAN_ID = /^plan_[a-z0-9]{8,40}$/;
const RUN_ID = /^run_[a-z0-9]{8,40}$/;
const CONFLICT_ID = /^cnf_[a-z0-9]{8,40}$/;
const TOKEN = /^mig_[a-z0-9]{8,64}$/;
const HANDOFF_ID = /^hof_[a-z0-9]{8,40}$/;
const CLEANUP_ID = /^cln_[a-z0-9]{8,40}$/;
const STAGE_ID = /^stg_[a-z0-9_-]{4,80}$/;
const RELEASE_PAGE_URL = /^https:\/\/github\.com\/iffinland\/wordpress-to-qortal\/releases\/tag\/v[0-9A-Za-z.-]+$/;

const SECRET_KEY = /(password|passwd|secret|token|apikey|api_key|seed|privatekey|private_key|wallet|authorization|cookie)/i;
const MAX_STRING = 20_000;
const MAX_PAYLOAD_BYTES = 1_000_000;

type Dict = Record<string, unknown>;

function fail(message: string): never {
  throw new IpcValidationError(message);
}

export function isPlainObject(value: unknown): value is Dict {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown, label: string, { optional = false } = {}): Dict {
  if (value === undefined && optional) return {};
  if (!isPlainObject(value)) fail(label + ' must be an object.');
  return value;
}

function assertPayloadSize(payload: unknown): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(payload ?? {});
  } catch {
    fail('payload must be JSON-serializable.');
  }
  if (encoded.length > MAX_PAYLOAD_BYTES) fail('payload is too large.');
}

function text(value: unknown, label: string, { optional = false, max = 500, pattern = null as RegExp | null, trim = true } = {}): string | undefined {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    fail(label + ' is required.');
  }
  if (typeof value !== 'string') fail(label + ' must be a string.');
  const normalized = trim ? value.trim() : value;
  if (!optional && normalized === '') fail(label + ' is required.');
  if (normalized.length > max) fail(label + ' is too long.');
  if (pattern && !pattern.test(normalized)) fail(label + ' has an invalid format.');
  return normalized;
}

function bool(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(label + ' must be a boolean.');
  return value;
}

function integer(value: unknown, label: string, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}): number | undefined {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    fail(label + ' is required.');
  }
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    fail(label + ' must be an integer between ' + min + ' and ' + max + '.');
  }
  return value as number;
}

function numeric(value: unknown, label: string, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}): number | undefined {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    fail(label + ' is required.');
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(label + ' must be a number between ' + min + ' and ' + max + '.');
  }
  return value;
}

function stringArray(value: unknown, label: string, maxItems = 50): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(label + ' must be an array.');
  if (value.length > maxItems) fail(label + ' has too many entries.');
  return value.map((entry, index) => text(entry, label + '[' + index + ']', { max: 200 }) as string);
}

function integerArray(value: unknown, label: string, { min = 0, max = Number.MAX_SAFE_INTEGER, maxItems = 500 } = {}): number[] {
  if (!Array.isArray(value)) fail(label + ' must be an array.');
  if (value.length > maxItems) fail(label + ' has too many entries.');
  return value.map((entry, index) => integer(entry, label + '[' + index + ']', { min, max }) as number);
}

function optionalBool(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return bool(value, label, false);
}

/**
 * Sanitize the bounded quick-scan selection. The engine accepts these members
 * (include/postIds/ids, slug/slugs, perPage, maxPages, maxItems, contentTypes)
 * and must receive them unchanged; dropping them turns a three-post quick scan
 * into a default 100-item window.
 */
function sanitizeDiscoverySelection(input: unknown): Dict {
  const selection = object(input, 'selection', { optional: true });
  const out: Dict = {};
  const include = selection.include ?? selection.postIds ?? selection.ids;
  if (include !== undefined) out.include = integerArray(include, 'selection.include', { min: 1, max: 1_000_000, maxItems: 500 });
  if (selection.slug !== undefined) out.slug = stringArray(selection.slug, 'selection.slug', 500);
  if (selection.slugs !== undefined) out.slugs = stringArray(selection.slugs, 'selection.slugs', 500);
  for (const [key, min, max] of [['perPage', 1, 100], ['maxPages', 1, 20], ['maxItems', 1, 1_000_000]] as Array<[string, number, number]>) {
    if (selection[key] !== undefined) out[key] = integer(selection[key], 'selection.' + key, { min, max });
  }
  if (selection.contentTypes !== undefined) out.contentTypes = stringArray(selection.contentTypes, 'selection.contentTypes', 20);
  return out;
}

function projectId(params: Dict): string {
  return text(params.projectId, 'projectId', { pattern: PROJECT_ID }) as string;
}

function planId(params: Dict): string {
  return text(params.planId, 'planId', { pattern: PLAN_ID }) as string;
}

function runId(params: Dict): string {
  return text(params.runId, 'runId', { pattern: RUN_ID }) as string;
}

function handoffId(params: Dict): string {
  return text(params.handoffId, 'handoffId', { pattern: HANDOFF_ID }) as string;
}

function nodeUrl(value: unknown): string {
  const raw = text(value, 'nodeUrl', { max: 2000 }) as string;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail('nodeUrl must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail('nodeUrl must use http or https.');
  if (parsed.username || parsed.password) fail('nodeUrl must not contain credentials.');
  if (parsed.search || parsed.hash) fail('nodeUrl must not contain a query or fragment.');
  return (parsed.origin + parsed.pathname).replace(/\/+$/, '');
}

function absolutePath(value: unknown, label: string): string {
  const path = text(value, label, { max: 4096 }) as string;
  if (!path.startsWith('/')) fail(label + ' must be an absolute path.');
  if (path.includes('\u0000')) fail(label + ' contains invalid characters.');
  return path;
}

export function sanitizeAuth(input: unknown): Dict {
  const auth = object(input, 'auth', { optional: true });
  const mode = text(auth.mode, 'auth.mode', { optional: true, max: 40 }) ?? 'none';
  if (!['none', 'application_password', 'session'].includes(mode)) {
    fail('auth.mode is not supported.');
  }
  if (mode === 'none') return { mode: 'none' };
  if (mode === 'application_password') {
    return {
      mode,
      username: text(auth.username, 'auth.username', { optional: true, max: 200 }) ?? '',
      appPassword: text(auth.appPassword, 'auth.appPassword', { optional: true, max: 500, trim: false }) ?? ''
    };
  }
  return {
    mode,
    username: text(auth.username, 'auth.username', { optional: true, max: 200 }) ?? '',
    password: text(auth.password, 'auth.password', { optional: true, max: 500, trim: false }) ?? '',
    loginUrl: text(auth.loginUrl, 'auth.loginUrl', { optional: true, max: 2000 }) ?? '/login/'
  };
}

export function sanitizeSource(input: unknown): Dict {
  const source = object(input, 'source', { optional: true });
  const baseUrl = text(source.baseUrl, 'source.baseUrl', { optional: true, max: 2000 });
  if (baseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      fail('source.baseUrl must be a valid URL.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) fail('source.baseUrl must be an http or https URL.');
    if (parsed.username || parsed.password) fail('source.baseUrl must not contain credentials.');
  }
  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(source.timeoutMs !== undefined ? { timeoutMs: integer(source.timeoutMs, 'source.timeoutMs', { min: 1000, max: 1800000, optional: true }) } : {})
  };
}

export function sanitizeTarget(input: unknown): Dict {
  const target = object(input, 'target', { optional: true });
  // Do not trim or otherwise rewrite the registered display name. Core allows
  // internal spaces and non-ASCII text, and the exact bytes must survive the
  // handoff, receipt and ownership check.
  const qdnName = text(target.qdnName, 'target.qdnName', { optional: true, max: 200, trim: false });
  if (qdnName) {
    const checked = checkQortalName(qdnName);
    if (!checked.ok) fail('target.qdnName: ' + checked.message);
  }
  return {
    ...(qdnName ? { qdnName } : {}),
    ...(target.siteName !== undefined ? { siteName: text(target.siteName, 'target.siteName', { optional: true, max: 200 }) } : {}),
    ...(target.siteDescription !== undefined ? { siteDescription: text(target.siteDescription, 'target.siteDescription', { optional: true, max: 2000 }) } : {})
  };
}

function sanitizeFilters(input: unknown): Dict {
  const filters = object(input, 'filters', { optional: true });
  const out: Dict = {};
  for (const key of ['after', 'before', 'modifiedAfter', 'modifiedBefore']) {
    if (filters[key] !== undefined) {
      const value = text(filters[key], 'filters.' + key, { optional: true, max: 40 });
      if (value && Number.isNaN(Date.parse(value))) fail('filters.' + key + ' must be an ISO date.');
      if (value) out[key] = value;
    }
  }
  if (filters.contentTypes !== undefined) out.contentTypes = stringArray(filters.contentTypes, 'filters.contentTypes');
  if (filters.statuses !== undefined) out.statuses = stringArray(filters.statuses, 'filters.statuses');
  if (filters.search !== undefined) out.search = text(filters.search, 'filters.search', { optional: true, max: 200 });
  return out;
}

function sanitizePlanning(input: unknown): Dict {
  const planning = object(input, 'planning', { optional: true });
  const out: Dict = {};
  const ints: Array<[string, number, number]> = [['batchSize', 1, 1000], ['maxScanItems', 1, 1000000], ['feePerResource', 0, 1000]];
  for (const [key, min, max] of ints) {
    if (planning[key] !== undefined) out[key] = integer(planning[key], 'planning.' + key, { min, max });
  }
  for (const key of ['includeRouteChanges', 'includePages', 'includeReserved']) {
    if (planning[key] !== undefined) out[key] = bool(planning[key], 'planning.' + key, true);
  }
  if (planning.order !== undefined) {
    const order = text(planning.order, 'planning.order', { max: 10 });
    if (!['asc', 'desc'].includes(order as string)) fail('planning.order is invalid.');
    out.order = order;
  }
  return out;
}

function sanitizeDisk(input: unknown): Dict {
  const disk = object(input, 'disk', { optional: true });
  const out: Dict = {};
  for (const key of ['reserveBytes', 'maxBytesPerRun', 'maxFileBytes', 'maxFilesPerRun', 'unknownSizeBytes']) {
    if (disk[key] !== undefined) out[key] = integer(disk[key], 'disk.' + key, { min: 0, max: 1099511627776 });
  }
  if (disk.unknownSizePolicy !== undefined) {
    const policy = text(disk.unknownSizePolicy, 'disk.unknownSizePolicy', { max: 20 });
    if (!['reject', 'cap', 'estimate'].includes(policy as string)) fail('disk.unknownSizePolicy is invalid.');
    out.unknownSizePolicy = policy;
  }
  if (disk.safetyFactor !== undefined) {
    const factor = disk.safetyFactor;
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 1 || factor > 10) fail('disk.safetyFactor is invalid.');
    out.safetyFactor = factor;
  }
  return out;
}

function sanitizeMedia(input: unknown): Dict {
  const media = object(input, 'media', { optional: true });
  const out: Dict = {};
  for (const key of ['concurrency', 'timeoutMs', 'maxRetries', 'retryDelayMs', 'maxRedirects']) {
    if (media[key] !== undefined) out[key] = integer(media[key], 'media.' + key, { min: 0, max: 600000 });
  }
  for (const key of ['allowExternalMedia', 'allowLoopback', 'includeUnreferencedAttachments']) {
    if (media[key] !== undefined) out[key] = bool(media[key], 'media.' + key, false);
  }
  return out;
}

function sanitizeSettings(input: unknown): Dict {
  const settings = object(input, 'settings', { optional: true });
  const out: Dict = {};
  if (settings.planning !== undefined) out.planning = sanitizePlanning(settings.planning);
  if (settings.disk !== undefined) out.disk = sanitizeDisk(settings.disk);
  if (settings.media !== undefined) out.media = sanitizeMedia(settings.media);
  if (settings.batchSize !== undefined) out.batchSize = integer(settings.batchSize, 'settings.batchSize', { min: 1, max: 1000 });
  if (settings.desktopWizard !== undefined) out.desktopWizard = sanitizePersisted(settings.desktopWizard, 0);
  return out;
}

/**
 * Sanitize a value that is about to be persisted as JSON.
 *
 * JSON has no undefined: object keys with an undefined value are dropped and
 * undefined array entries become null. The previous implementation rejected
 * any undefined value, which made an ordinary wizard save fail with
 * "persisted value type is not allowed." whenever an optional field (for
 * example the cached discovery result) was absent. Legacy projects therefore
 * could not be saved before a fresh scan. Mirror JSON semantics instead, and
 * reject only values JSON cannot represent.
 */
export function sanitizePersisted(value: unknown, depth = 0): unknown {
  if (depth > 6) fail('persisted state is too deep.');
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length > 500) fail('persisted array is too large.');
    return value.map((entry) => {
      const clean = sanitizePersisted(entry, depth + 1);
      // JSON.stringify turns a top-level undefined array member into null.
      return clean === undefined ? null : clean;
    });
  }
  if (isPlainObject(value)) {
    const out: Dict = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      if (typeof entry === 'string' && entry.length > MAX_STRING) fail('persisted value is too long.');
      const clean = sanitizePersisted(entry, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  if (typeof value === 'string' && value.length > MAX_STRING) fail('persisted value is too long.');
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
    fail('persisted value type is not allowed (' + (typeof value) + ').');
  }
  return value;
}

function sanitizeWizard(input: unknown): Dict {
  const wizard = object(input, 'wizard');
  const step = integer(wizard.step, 'wizard.step', { min: 1, max: 5 }) as number;
  if (wizard.completedSteps !== undefined && !Array.isArray(wizard.completedSteps)) {
    fail('wizard.completedSteps must be an array.');
  }
  // Accept legacy numeric indexes and canonical string ids by migrating them
  // to the canonical representation. Never reject an existing project record
  // only because an older build wrote numbers.
  const migrated = migrateWizardForLoad(wizard);
  const loaded = migrated.wizard;
  const completedSteps = normalizeCompletedSteps(loaded.completedSteps);
  const loadedWebsite = loaded.website ? object(loaded.website, 'wizard.website', { optional: true }) : {};
  const service = text(loadedWebsite.service, 'wizard.website.service', { optional: true, max: 10 });
  const normalizedService = service === undefined ? undefined : service.toUpperCase();
  if (normalizedService !== undefined && !['APP', 'WEBSITE'].includes(normalizedService)) {
    fail('wizard.website.service must be APP or WEBSITE.');
  }
  return {
    step,
    completedSteps,
    wizardVersion: WIZARD_STATE_VERSION,
    adapterId: text(loaded.adapterId, 'wizard.adapterId', { optional: true, max: 32 }) ?? 'wordpress',
    sourceUrl: text(loaded.sourceUrl, 'wizard.sourceUrl', { optional: true, max: 2000 }) ?? '',
    authMode: text(loaded.authMode, 'wizard.authMode', { optional: true, max: 40 }) ?? 'none',
    connection: loaded.connection ? sanitizePersisted(loaded.connection) : null,
    targetQdnName: text(loaded.targetQdnName, 'wizard.targetQdnName', { optional: true, max: 40 }) ?? '',
    siteTitle: text(loaded.siteTitle, 'wizard.siteTitle', { optional: true, max: 200 }) ?? '',
    siteDescription: text(loaded.siteDescription, 'wizard.siteDescription', { optional: true, max: 2000 }) ?? '',
    ...(normalizedService !== undefined ? {
      website: {
        ...sanitizePersisted(loadedWebsite) as Dict,
        service: normalizedService
      }
    } : {}),
    preferences: loaded.preferences ? sanitizePersisted(loaded.preferences) : {},
    planId: loaded.planId === null || loaded.planId === undefined ? null : text(loaded.planId, 'wizard.planId', { pattern: PLAN_ID }) as string,
    updatedAt: text(loaded.updatedAt, 'wizard.updatedAt', { optional: true, max: 40 }) ?? new Date().toISOString()
  };
}

export function validateIpcPayload(channel: string, payload: unknown): Dict {
  assertPayloadSize(payload);
  const params = object(payload, 'payload', { optional: true });

  switch (channel) {
    case IPC.appInfo:
    case IPC.appSettings:
    case IPC.nodesGet:
    case IPC.sourceList:
    case IPC.credentialStatus:
    case IPC.updatesState:
    case IPC.updatesCheck:
      return {};

    case IPC.appReportError:
      return {
        source: text(params.source, 'source', { optional: true, max: 120 }) ?? 'renderer',
        message: text(params.message, 'message', { max: 2000 }) as string,
        stack: text(params.stack, 'stack', { optional: true, max: 8000, trim: false }),
        componentStack: text(params.componentStack, 'componentStack', { optional: true, max: 8000, trim: false })
      };

    case IPC.nodesSet:
      return {
        url: text(params.url, 'url', { max: 1000 }) as string,
        selected: bool(params.selected, 'selected', true)
      };

    case IPC.nodesRemove:
      return { url: text(params.url, 'url', { max: 1000 }) as string };

    case IPC.nodesTest:
      return { url: text(params.url, 'url', { max: 1000 }) as string };

    case IPC.updatesSetNode:
      return { url: text(params.url, 'url', { max: 1000 }) as string };

    case IPC.updatesOpenRelease:
      return { url: text(params.url, 'url', { max: 1000, pattern: RELEASE_PAGE_URL }) as string };

    case IPC.setDataRoot:
      return { path: absolutePath(params.path, 'path') };

    case IPC.openPath:
      return { path: absolutePath(params.path, 'path') };

    case IPC.projectList:
      return { includeArchived: bool(params.includeArchived, 'includeArchived', false) };

    case IPC.projectInspect:
    case IPC.projectSnapshot:
    case IPC.identityGet:
    case IPC.mediaInspect:
    case IPC.runList:
      return { projectId: projectId(params) };

    case IPC.projectCreate:
      return {
        name: text(params.name, 'name', { max: 120 }) as string,
        source: sanitizeSource(params.source),
        target: sanitizeTarget(params.target),
        settings: sanitizeSettings(params.settings)
      };

    case IPC.projectOpen:
      return { projectId: projectId(params), recoverStaleLock: bool(params.recoverStaleLock, 'recoverStaleLock', false) };

    case IPC.projectArchive:
      return { projectId: projectId(params), deleteLocalData: bool(params.deleteLocalData, 'deleteLocalData', false) };

    case IPC.projectUpdate:
      return {
        projectId: projectId(params),
        patch: {
          ...(params.patch && isPlainObject(params.patch) && params.patch.name !== undefined
            ? { name: text(params.patch.name, 'patch.name', { max: 120 }) }
            : {}),
          ...(params.patch && isPlainObject(params.patch) && params.patch.source !== undefined ? { source: sanitizeSource(params.patch.source) } : {}),
          ...(params.patch && isPlainObject(params.patch) && params.patch.target !== undefined ? { target: sanitizeTarget(params.patch.target) } : {}),
          ...(params.patch && isPlainObject(params.patch) && params.patch.settings !== undefined ? { settings: sanitizeSettings(params.patch.settings) } : {})
        }
      };

    case IPC.projectSaveWizard:
      return { projectId: projectId(params), wizard: sanitizeWizard(params.wizard) };

    case IPC.sourceCapabilities:
      return { adapterId: text(params.adapterId, 'adapterId', { max: 32 }) as string };

    case IPC.sourceValidate:
      return {
        projectId: projectId(params),
        adapterId: text(params.adapterId, 'adapterId', { optional: true, max: 32 }),
        auth: sanitizeAuth(params.auth),
        source: sanitizeSource(params.source),
        remember: bool(params.remember, 'remember', false)
      };

    case IPC.sourceDiscover: {
      // An explicit mode is required by the engine (SOURCE_SCAN_MODE_REQUIRED).
      // Never default it here: a missing mode must stay missing so the engine
      // fails closed, and a bounded quick scan must keep its selection.
      const mode = text(params.mode, 'mode', { optional: true, max: 10 });
      if (mode !== undefined && !['quick', 'full'].includes(mode)) fail('mode must be "quick" or "full".');
      const includeTerms = optionalBool(params.includeTerms, 'includeTerms');
      const includeAssets = optionalBool(params.includeAssets, 'includeAssets');
      return {
        projectId: projectId(params),
        adapterId: text(params.adapterId, 'adapterId', { optional: true, max: 32 }),
        auth: sanitizeAuth(params.auth),
        source: sanitizeSource(params.source),
        contentTypes: stringArray(params.contentTypes, 'contentTypes'),
        query: params.query ? sanitizePersisted(params.query) : {},
        perPage: integer(params.perPage, 'perPage', { min: 1, max: 100, optional: true }),
        maxItems: integer(params.maxItems, 'maxItems', { min: 1, max: 1000000, optional: true }),
        ...(mode !== undefined ? { mode } : {}),
        selection: sanitizeDiscoverySelection(params.selection),
        ...(includeTerms !== undefined ? { includeTerms } : {}),
        ...(includeAssets !== undefined ? { includeAssets } : {}),
        ...(params.progressEvery !== undefined
          ? { progressEvery: integer(params.progressEvery, 'progressEvery', { min: 1, max: 10000, optional: true }) }
          : {})
      };
    }

    case IPC.identityValidateTarget:
      return { target: sanitizeTarget(params.target) };

    case IPC.identityMigrationPreview:
      return { projectId: projectId(params), target: sanitizeTarget(params.target) };

    case IPC.identityApplyMigration:
      return { projectId: projectId(params), token: text(params.token, 'token', { pattern: TOKEN }) as string };

    case IPC.identityResolveConflict:
      return {
        projectId: projectId(params),
        conflictId: text(params.conflictId, 'conflictId', { pattern: CONFLICT_ID }) as string,
        resolution: (() => {
          const resolution = text(params.resolution, 'resolution', { max: 20 }) as string;
          if (!['skip', 'alternate', 'abort'].includes(resolution)) fail('resolution is invalid.');
          return resolution;
        })()
      };

    case IPC.planList:
      return { projectId: projectId(params), limit: integer(params.limit, 'limit', { min: 1, max: 1000, optional: true }) };

    case IPC.planCreate:
      return {
        projectId: projectId(params),
        batchSize: integer(params.batchSize, 'batchSize', { min: 1, max: 1000, optional: true }),
        filters: sanitizeFilters(params.filters),
        planning: sanitizePlanning(params.planning),
        disk: sanitizeDisk(params.disk),
        media: sanitizeMedia(params.media),
        estimateMedia: bool(params.estimateMedia, 'estimateMedia', true),
        persist: bool(params.persist, 'persist', true)
      };

    case IPC.planGet:
      return { projectId: projectId(params), planId: planId(params) };

    case IPC.mediaDownload:
      return {
        projectId: projectId(params),
        planId: planId(params),
        concurrency: integer(params.concurrency, 'concurrency', { min: 1, max: 32, optional: true }),
        disk: sanitizeDisk(params.disk),
        media: sanitizeMedia(params.media)
      };

    case IPC.publicationList:
    case IPC.publicationHistory:
      return { projectId: projectId(params) };

    case IPC.publicationPrepare:
      return {
        projectId: projectId(params),
        planId: planId(params),
        selection: stringArray(params.selection, 'selection', 5000) ?? [],
        feePerResource: params.feePerResource === undefined
          ? undefined
          : numeric(params.feePerResource, 'feePerResource', { min: 0, max: 1000000 }),
        feeCurrency: 'QORT'
      };

    case IPC.openUrl: {
      const target = text(params.url, 'url', { max: 4000, trim: false });
      if (typeof target !== 'string' || target === '') fail('url is required.');
      let parsed: URL | null = null;
      try { parsed = new URL(target); } catch { parsed = null; }
      if (!parsed) fail('url must be a valid URL.');
      if (!['http:', 'https:'].includes(parsed.protocol)) fail('url must use http or https.');
      if (parsed.username || parsed.password) fail('url must not contain credentials.');
      return { url: parsed.toString() };
    }

    case IPC.publicationExportBundle:
      return { projectId: projectId(params), handoffId: handoffId(params) };

    case IPC.publicationGet:
      return { projectId: projectId(params), handoffId: handoffId(params), validate: bool(params.validate, 'validate', true) };

    case IPC.publicationImportReceipt:
      return {
        projectId: projectId(params),
        handoffId: handoffId(params),
        receipt: object(params.receipt, 'receipt')
      };

    case IPC.publicationVerify:
      return {
        projectId: projectId(params),
        handoffId: handoffId(params),
        nodeUrl: nodeUrl(params.nodeUrl),
        attempts: integer(params.attempts, 'attempts', { min: 1, max: 60, optional: true }),
        intervalMs: integer(params.intervalMs, 'intervalMs', { min: 0, max: 60000, optional: true })
      };

    case IPC.publicationResources:
      return {
        projectId: projectId(params),
        handoffId: params.handoffId === undefined ? null : handoffId(params)
      };

    case IPC.publicationBatches:
      return { projectId: projectId(params), handoffId: handoffId(params) };

    case IPC.diskCheck:
      return {
        projectId: projectId(params),
        knownBytes: integer(params.knownBytes, 'knownBytes', { min: 0, optional: true }),
        unknownCount: integer(params.unknownCount, 'unknownCount', { min: 0, max: 1000000, optional: true }),
        metadataBytes: integer(params.metadataBytes, 'metadataBytes', { min: 0, optional: true }),
        disk: sanitizeDisk(params.disk)
      };

    case IPC.runGet:
      return { projectId: projectId(params), runId: runId(params) };

    case IPC.runEvents:
      return {
        projectId: projectId(params),
        runId: params.runId === undefined ? null : runId(params),
        afterSeq: integer(params.afterSeq, 'afterSeq', { min: 0, optional: true }),
        limit: integer(params.limit, 'limit', { min: 1, max: 5000, optional: true })
      };

    case IPC.runPause:
    case IPC.runCancel:
      return {
        projectId: projectId(params),
        runId: runId(params),
        reason: text(params.reason, 'reason', { optional: true, max: 200 })
      };

    case IPC.credentialForget:
      return { projectId: projectId(params) };

    case IPC.diagnosticsExport:
      return { projectId: projectId(params) };

    case IPC.recoveryStatus:
      return { projectId: projectId(params) };

    case IPC.recoveryResume: {
      const run = params.runId === undefined ? null : runId(params);
      const stage = params.stageId === undefined ? null : text(params.stageId, 'stageId', { pattern: STAGE_ID, max: 80 });
      if ((run === null) === (stage === null)) fail('exactly one of runId or stageId is required.');
      return {
        projectId: projectId(params),
        runId: run,
        stageId: stage,
        auth: params.auth === undefined ? undefined : sanitizeAuth(params.auth)
      };
    }

    case IPC.recoveryDismiss:
      return {
        projectId: projectId(params),
        runId: runId(params),
        reason: text(params.reason, 'reason', { optional: true, max: 200 })
      };

    case IPC.recoveryReconcile:
      return {
        projectId: projectId(params),
        handoffId: params.handoffId === undefined || params.handoffId === null ? null : handoffId(params),
        nodeUrl: nodeUrl(params.nodeUrl)
      };

    case IPC.cleanupPreview:
    case IPC.cleanupStart:
      return {
        projectId: projectId(params),
        handoffIds: stringArray(params.handoffIds, 'handoffIds', 100) ?? null,
        includeHandoffPayloads: bool(params.includeHandoffPayloads, 'includeHandoffPayloads', true),
        includeParts: bool(params.includeParts, 'includeParts', true),
        retentionDays: integer(params.retentionDays, 'retentionDays', { min: 0, max: 3650, optional: true }),
        dryRun: channel === IPC.cleanupStart ? bool(params.dryRun, 'dryRun', false) : undefined
      };

    case IPC.cleanupList:
      return { projectId: projectId(params), limit: integer(params.limit, 'limit', { min: 1, max: 500, optional: true }) };

    case IPC.cleanupGet:
    case IPC.cleanupRestore:
    case IPC.cleanupResume:
      return { projectId: projectId(params), cleanupId: text(params.cleanupId, 'cleanupId', { pattern: CLEANUP_ID, max: 40 }) };

    case IPC.cleanupPurge:
      return {
        projectId: projectId(params),
        cleanupId: text(params.cleanupId, 'cleanupId', { pattern: CLEANUP_ID, max: 40 }),
        force: bool(params.force, 'force', false)
      };

    case IPC.historyList:
      return { projectId: projectId(params), limit: integer(params.limit, 'limit', { min: 1, max: 5000, optional: true }) };

    case IPC.historyExport:
      return { projectId: projectId(params), reason: text(params.reason, 'reason', { optional: true, max: 80 }) };

    default:
      fail('Unknown IPC channel: ' + channel);
  }
}

