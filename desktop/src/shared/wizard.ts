/**
 * Canonical wizard state helpers.
 *
 * Step ids are stable strings. Older desktop builds persisted numeric step
 * indexes (1..5); both representations are accepted on load and normalized to
 * the canonical ids before anything is written back. Migration is idempotent.
 */

export const WIZARD_STEP_IDS = ['source', 'connection', 'destination', 'preferences', 'plan'] as const;
export type WizardStepId = (typeof WIZARD_STEP_IDS)[number];

export const WIZARD_STEP_LABELS: Record<WizardStepId, string> = {
  source: 'Source CMS',
  connection: 'WordPress connection',
  destination: 'Qortal destination',
  preferences: 'Import preferences',
  plan: 'Plan and review'
};

export const WIZARD_STEP_INDEX: Record<WizardStepId, number> = {
  source: 1,
  connection: 2,
  destination: 3,
  preferences: 4,
  plan: 5
};

const LEGACY_INDEX_TO_ID: Record<number, WizardStepId> = {
  1: 'source',
  2: 'connection',
  3: 'destination',
  4: 'preferences',
  5: 'plan'
};

export function wizardStepIdForIndex(index: number): WizardStepId | null {
  return Number.isInteger(index) ? LEGACY_INDEX_TO_ID[index] ?? null : null;
}

export function isWizardStepId(value: unknown): value is WizardStepId {
  return typeof value === 'string' && (WIZARD_STEP_IDS as readonly string[]).includes(value);
}

function legacyStepId(value: unknown): WizardStepId | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return LEGACY_INDEX_TO_ID[value] ?? null;
  }
  if (typeof value === 'string' && /^[1-5]$/.test(value.trim())) {
    return LEGACY_INDEX_TO_ID[Number(value.trim())] ?? null;
  }
  return null;
}

export interface CompletedStepsMigration {
  steps: WizardStepId[];
  changed: boolean;
  legacy: boolean;
  unknown: unknown[];
}

/**
 * Normalize a persisted completedSteps value.
 *
 * Accepts canonical ids, legacy numeric indexes, numeric strings and mixed
 * arrays. Duplicates are removed, order is canonical, unknown entries are
 * reported (never stringified into a step). Idempotent.
 */
export function normalizeCompletedStepsDetailed(value: unknown): CompletedStepsMigration {
  if (value === undefined || value === null) {
    return { steps: [], changed: false, legacy: false, unknown: [] };
  }
  if (!Array.isArray(value)) {
    return { steps: [], changed: true, legacy: false, unknown: [value] };
  }
  const steps = new Set<WizardStepId>();
  const unknown: unknown[] = [];
  let legacy = false;
  let changed = false;
  for (const entry of value) {
    if (isWizardStepId(entry)) {
      steps.add(entry);
      continue;
    }
    const mapped = legacyStepId(entry);
    if (mapped) {
      steps.add(mapped);
      legacy = true;
      changed = true;
      continue;
    }
    unknown.push(entry);
    changed = true;
  }
  const ordered = [...steps].sort((left, right) => WIZARD_STEP_INDEX[left] - WIZARD_STEP_INDEX[right]);
  if (ordered.length !== value.length) changed = true;
  if (ordered.some((step, index) => value[index] !== step)) changed = true;
  return { steps: ordered, changed, legacy, unknown };
}

export function normalizeCompletedSteps(value: unknown): WizardStepId[] {
  return normalizeCompletedStepsDetailed(value).steps;
}

export function completedStepIndexes(value: unknown): number[] {
  return normalizeCompletedSteps(value).map((step) => WIZARD_STEP_INDEX[step]);
}

export function stepIndexToId(index: number): WizardStepId | null {
  return wizardStepIdForIndex(index);
}

/** Value for an <input type="date">, always UTC. */
export function dateInputValue(iso: unknown): string {
  if (typeof iso !== 'string' || iso.trim() === '') return '';
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : '';
}

/** Inclusive lower bound for a date-only filter. */
export function startOfDayIso(date: string): string {
  const parsed = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString();
}

/** Inclusive upper bound for a date-only filter (end of the selected day). */
export function endOfDayIso(date: string): string {
  const parsed = Date.parse(date + 'T23:59:59.999Z');
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toISOString();
}

export function isMidnightUtc(iso: unknown): boolean {
  if (typeof iso !== 'string') return false;
  return /T00:00:00\.000Z$/.test(iso);
}

/**
 * Older builds stored "before" as the start of the selected day, which silently
 * excluded the whole selected end day. A date-only filter is migrated once to
 * the inclusive end of that day. Wizard values already at another time of day
 * are left untouched.
 */
export function normalizeBeforeDate(value: unknown, wizardVersion: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  const version = Number(wizardVersion);
  if (Number.isFinite(version) && version >= 2) return value;
  if (!isMidnightUtc(value)) return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const end = new Date(parsed + 86_399_999);
  return end.toISOString();
}

export interface WizardLoadMigration {
  wizard: Record<string, unknown>;
  changed: boolean;
  legacySteps: boolean;
  unknownSteps: unknown[];
}

/**
 * Normalize a persisted desktopWizard object for loading. Returns the same
 * object shape plus wizardVersion: 2. Does not delete any settings.
 */
export function migrateWizardForLoad(input: unknown): WizardLoadMigration {
  const wizard = input && typeof input === 'object' && !Array.isArray(input)
    ? { ...(input as Record<string, unknown>) }
    : {};
  const completed = normalizeCompletedStepsDetailed(wizard.completedSteps);
  const version = Number(wizard.wizardVersion);
  const preferences = wizard.preferences && typeof wizard.preferences === 'object' && !Array.isArray(wizard.preferences)
    ? { ...(wizard.preferences as Record<string, unknown>) }
    : {};
  let changed = completed.changed;
  if (wizard.completedSteps !== undefined && !Array.isArray(wizard.completedSteps)) changed = true;
  if (!Number.isFinite(version) || version < 2) changed = true;
  if (Object.prototype.hasOwnProperty.call(preferences, 'before')) {
    const normalized = normalizeBeforeDate(preferences.before, version);
    if (normalized !== preferences.before) {
      preferences.before = normalized;
      changed = true;
    }
  }
  wizard.completedSteps = completed.steps;
  wizard.wizardVersion = 2;
  wizard.preferences = preferences;
  return {
    wizard,
    changed,
    legacySteps: completed.legacy,
    unknownSteps: completed.unknown
  };
}

function utcLabel(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const iso = new Date(parsed).toISOString();
  return iso.slice(0, 10) + ' ' + iso.slice(11, 16) + ' UTC';
}

export function describeDateRange(after: unknown, before: unknown): string {
  const from = typeof after === 'string' && after ? after : null;
  const until = typeof before === 'string' && before ? before : null;
  if (!from && !until) return 'No published-date filter (all dates).';
  if (from && until) return 'Published from ' + utcLabel(from) + ' through ' + utcLabel(until) + '.';
  if (from) return 'Published from ' + utcLabel(from) + ' onwards.';
  return 'Published up to ' + utcLabel(until as string) + '.';
}

/** Readable, object-safe description of an unsupported capability or feature. */
export function describeUnsupportedValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return key;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return key + ': ' + String(value);
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const entry = value as Record<string, unknown>;
    const label = String(entry.name ?? entry.type ?? entry.feature ?? key);
    const count = Number.isFinite(Number(entry.count)) && entry.count !== null && entry.count !== undefined
      ? ' (' + String(entry.count) + ')'
      : '';
    const message = typeof entry.message === 'string' && entry.message.trim() !== ''
      ? ' — ' + entry.message
      : '';
    return label + count + message;
  }
  if (Array.isArray(value)) {
    return key + ': ' + value.map((entry) => describeUnsupportedValue('', entry)).join(', ');
  }
  return key;
}

export function describeUnsupportedList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const record = entry as Record<string, unknown>;
        return describeUnsupportedValue(String(record.code ?? record.type ?? record.feature ?? String(index)), entry)
          .replace(/^[^:]*:\s*/, '');
      }
      return describeUnsupportedValue(String(index), entry).replace(/^[^:]*:\s*/, '');
    }).filter((entry) => entry.trim() !== '');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => describeUnsupportedValue(key, entry));
  }
  return [String(value)];
}

export function sanitizeWebsiteService(value: unknown): 'APP' | 'WEBSITE' {
  return typeof value === 'string' && value.toUpperCase() === 'WEBSITE' ? 'WEBSITE' : 'APP';
}
