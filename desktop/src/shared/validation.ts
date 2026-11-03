import { IPC } from './channels.js';
import { checkQortalName } from './qortalName.js';

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
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) fail('source.baseUrl must be an http or https URL.');
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
  for (const key of ['allowExternalMedia', 'allowLoopback']) {
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

export function sanitizePersisted(value: unknown, depth = 0): unknown {
  if (depth > 6) fail('persisted state is too deep.');
  if (Array.isArray(value)) {
    if (value.length > 500) fail('persisted array is too large.');
    return value.map((entry) => sanitizePersisted(entry, depth + 1));
  }
  if (isPlainObject(value)) {
    const out: Dict = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      if (typeof entry === 'string' && entry.length > MAX_STRING) fail('persisted value is too long.');
      out[key] = sanitizePersisted(entry, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > MAX_STRING) fail('persisted value is too long.');
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) fail('persisted value type is not allowed.');
  return value;
}

function sanitizeWizard(input: unknown): Dict {
  const wizard = object(input, 'wizard');
  const step = integer(wizard.step, 'wizard.step', { min: 1, max: 5 }) as number;
  const completedSteps = stringArray(wizard.completedSteps, 'wizard.completedSteps', 5) ?? [];
  const parsed = completedSteps.map((entry) => Number(entry));
  if (parsed.some((entry) => !Number.isInteger(entry) || entry < 1 || entry > 5)) fail('wizard.completedSteps is invalid.');
  return {
    step,
    completedSteps: parsed,
    adapterId: text(wizard.adapterId, 'wizard.adapterId', { optional: true, max: 32 }) ?? 'wordpress',
    sourceUrl: text(wizard.sourceUrl, 'wizard.sourceUrl', { optional: true, max: 2000 }) ?? '',
    authMode: text(wizard.authMode, 'wizard.authMode', { optional: true, max: 40 }) ?? 'none',
    connection: wizard.connection ? sanitizePersisted(wizard.connection) : null,
    targetQdnName: text(wizard.targetQdnName, 'wizard.targetQdnName', { optional: true, max: 40 }) ?? '',
    siteTitle: text(wizard.siteTitle, 'wizard.siteTitle', { optional: true, max: 200 }) ?? '',
    siteDescription: text(wizard.siteDescription, 'wizard.siteDescription', { optional: true, max: 2000 }) ?? '',
    preferences: wizard.preferences ? sanitizePersisted(wizard.preferences) : {},
    planId: wizard.planId === null || wizard.planId === undefined ? null : text(wizard.planId, 'wizard.planId', { pattern: PLAN_ID }) as string,
    updatedAt: text(wizard.updatedAt, 'wizard.updatedAt', { optional: true, max: 40 }) ?? new Date().toISOString()
  };
}

export function validateIpcPayload(channel: string, payload: unknown): Dict {
  assertPayloadSize(payload);
  const params = object(payload, 'payload', { optional: true });

  switch (channel) {
    case IPC.appInfo:
    case IPC.appSettings:
    case IPC.sourceList:
    case IPC.credentialStatus:
      return {};

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

    case IPC.sourceDiscover:
      return {
        projectId: projectId(params),
        adapterId: text(params.adapterId, 'adapterId', { optional: true, max: 32 }),
        auth: sanitizeAuth(params.auth),
        source: sanitizeSource(params.source),
        contentTypes: stringArray(params.contentTypes, 'contentTypes'),
        query: params.query ? sanitizePersisted(params.query) : {},
        perPage: integer(params.perPage, 'perPage', { min: 1, max: 100, optional: true }),
        maxItems: integer(params.maxItems, 'maxItems', { min: 1, max: 1000000, optional: true })
      };

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

    default:
      fail('Unknown IPC channel: ' + channel);
  }
}

