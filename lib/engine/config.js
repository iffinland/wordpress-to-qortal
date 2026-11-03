import { QmsError, ERROR_CODES } from './errors.js';

/**
 * Universal planning, disk and media defaults.
 *
 * Nothing here knows about a specific CMS, site or Qortal name. Historical
 * example projects can override these values in their own project settings;
 * new projects always start from these generic defaults.
 */
export const GIB = 1024 ** 3;
export const MIB = 1024 ** 2;

export const DEFAULT_PLANNING = Object.freeze({
  batchSize: 15,
  includeRouteChanges: true,
  includePages: true,
  includeReserved: false,
  maxScanItems: 50_000,
  order: 'desc',
  feePerResource: 0.01,
  feeCurrency: 'QORT'
});

export const DEFAULT_DISK = Object.freeze({
  reserveBytes: 10 * GIB,
  maxBytesPerRun: 2 * GIB,
  maxFileBytes: 256 * MIB,
  maxFilesPerRun: 500,
  unknownSizePolicy: 'reject',
  unknownSizeBytes: null,
  safetyFactor: 1
});

export const DEFAULT_MEDIA = Object.freeze({
  concurrency: 4,
  timeoutMs: 60_000,
  maxRetries: 2,
  retryDelayMs: 250,
  maxRedirects: 3,
  allowExternalMedia: false,
  allowLoopback: false
});

export const UNKNOWN_SIZE_POLICIES = Object.freeze(['reject', 'cap', 'estimate']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeSection(base, value, label) {
  if (value === undefined || value === null) {
    return { ...base };
  }
  if (!isPlainObject(value)) {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, label + ' must be an object.', {
      details: { label }
    });
  }
  return { ...base, ...value };
}

function assertInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new QmsError(
      ERROR_CODES.CONFIG_INVALID,
      label + ' must be an integer between ' + min + ' and ' + max + '.',
      { details: { label, value, min, max } }
    );
  }
  return value;
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, label + ' must be a boolean.', {
      details: { label, value }
    });
  }
  return value;
}

export function normalizeBatchSize(value, label = 'batchSize') {
  return assertInteger(value, label, { min: 1, max: 1000 });
}

export function normalizePlanningSettings(value = {}) {
  const planning = mergeSection(DEFAULT_PLANNING, value, 'settings.planning');
  normalizeBatchSize(planning.batchSize, 'settings.planning.batchSize');
  assertBoolean(planning.includeRouteChanges, 'settings.planning.includeRouteChanges');
  assertBoolean(planning.includePages, 'settings.planning.includePages');
  assertBoolean(planning.includeReserved, 'settings.planning.includeReserved');
  assertInteger(planning.maxScanItems, 'settings.planning.maxScanItems', { min: 1, max: 1_000_000 });
  if (!['asc', 'desc'].includes(planning.order)) {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, "settings.planning.order must be 'asc' or 'desc'.", {
      details: { value: planning.order }
    });
  }
  if (typeof planning.feePerResource !== 'number' || !Number.isFinite(planning.feePerResource) || planning.feePerResource < 0 || planning.feePerResource > 1000) {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, 'settings.planning.feePerResource must be a number between 0 and 1000.', {
      details: { value: planning.feePerResource }
    });
  }
  if (planning.feeCurrency !== 'QORT') {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, "settings.planning.feeCurrency must be 'QORT'.", {
      details: { value: planning.feeCurrency }
    });
  }
  return planning;
}

export function normalizeDiskSettings(value = {}) {
  const disk = mergeSection(DEFAULT_DISK, value, 'settings.disk');
  assertInteger(disk.reserveBytes, 'settings.disk.reserveBytes', { min: 0, max: 1024 * GIB });
  assertInteger(disk.maxBytesPerRun, 'settings.disk.maxBytesPerRun', { min: 0, max: 1024 * GIB });
  assertInteger(disk.maxFileBytes, 'settings.disk.maxFileBytes', { min: 1, max: 1024 * GIB });
  assertInteger(disk.maxFilesPerRun, 'settings.disk.maxFilesPerRun', { min: 1, max: 1_000_000 });
  if (disk.maxFileBytes > disk.maxBytesPerRun && disk.maxBytesPerRun !== 0) {
    throw new QmsError(
      ERROR_CODES.CONFIG_INVALID,
      'settings.disk.maxFileBytes cannot exceed maxBytesPerRun.',
      { details: { maxFileBytes: disk.maxFileBytes, maxBytesPerRun: disk.maxBytesPerRun } }
    );
  }
  if (!UNKNOWN_SIZE_POLICIES.includes(disk.unknownSizePolicy)) {
    throw new QmsError(
      ERROR_CODES.CONFIG_INVALID,
      'settings.disk.unknownSizePolicy must be one of ' + UNKNOWN_SIZE_POLICIES.join(', ') + '.',
      { details: { value: disk.unknownSizePolicy } }
    );
  }
  if (disk.unknownSizePolicy === 'estimate') {
    assertInteger(disk.unknownSizeBytes, 'settings.disk.unknownSizeBytes', {
      min: 1,
      max: disk.maxFileBytes
    });
  }
  if (typeof disk.safetyFactor !== 'number' || !Number.isFinite(disk.safetyFactor) || disk.safetyFactor < 1 || disk.safetyFactor > 10) {
    throw new QmsError(ERROR_CODES.CONFIG_INVALID, 'settings.disk.safetyFactor must be between 1 and 10.', {
      details: { value: disk.safetyFactor }
    });
  }
  return disk;
}

export function normalizeMediaSettings(value = {}) {
  const media = mergeSection(DEFAULT_MEDIA, value, 'settings.media');
  assertInteger(media.concurrency, 'settings.media.concurrency', { min: 1, max: 32 });
  assertInteger(media.timeoutMs, 'settings.media.timeoutMs', { min: 1000, max: 30 * 60_000 });
  assertInteger(media.maxRetries, 'settings.media.maxRetries', { min: 0, max: 10 });
  assertInteger(media.retryDelayMs, 'settings.media.retryDelayMs', { min: 0, max: 60_000 });
  assertInteger(media.maxRedirects, 'settings.media.maxRedirects', { min: 0, max: 10 });
  assertBoolean(media.allowExternalMedia, 'settings.media.allowExternalMedia');
  assertBoolean(media.allowLoopback, 'settings.media.allowLoopback');
  return media;
}

/**
 * Resolve effective settings for a project. project.settings.batchSize is
 * accepted as a legacy shorthand; explicit planning settings win.
 */
export function resolveProjectConfig(project = {}) {
  const settings = isPlainObject(project.settings) ? project.settings : {};
  const planningInput = { ...(settings.planning ?? {}) };
  if (planningInput.batchSize === undefined && settings.batchSize !== undefined) {
    planningInput.batchSize = settings.batchSize;
  }
  const planning = normalizePlanningSettings(planningInput);
  const disk = normalizeDiskSettings(settings.disk ?? {});
  const media = normalizeMediaSettings(settings.media ?? {});
  return { planning, disk, media };
}

/** Per-run overrides. Only explicitly provided keys replace project settings. */
export function resolveRunConfig(project = {}, overrides = {}) {
  const base = resolveProjectConfig(project);
  const planning = { ...base.planning };
  for (const key of ['batchSize', 'includeRouteChanges', 'includePages', 'includeReserved', 'maxScanItems', 'order', 'feePerResource', 'feeCurrency']) {
    if (overrides.planning?.[key] !== undefined) {
      planning[key] = overrides.planning[key];
    }
  }
  const disk = { ...base.disk };
  for (const key of Object.keys(DEFAULT_DISK)) {
    if (overrides.disk?.[key] !== undefined) {
      disk[key] = overrides.disk[key];
    }
  }
  const media = { ...base.media };
  for (const key of Object.keys(DEFAULT_MEDIA)) {
    if (overrides.media?.[key] !== undefined) {
      media[key] = overrides.media[key];
    }
  }
  return {
    planning: normalizePlanningSettings(planning),
    disk: normalizeDiskSettings(disk),
    media: normalizeMediaSettings(media)
  };
}

export function formatBytes(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return String(value);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = Math.max(0, number);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return amount.toFixed(unit === 0 ? 0 : 1) + ' ' + units[unit];
}
