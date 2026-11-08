import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import type { AdapterInfo, DesktopSettings, FilterDiagnostics, PlanCreateResult, PlanDocument, ProjectDocument, QmsEvent, RecoveryCandidate, SourceValidationResult, WizardState } from '../../shared/types.js';
import { Alert, Badge, Card, ErrorText, Field } from './Common.js';
import { createPlanPreviewFlight } from '../lib/plan-preview.js';
import { formatBytes, formatDate, formatScalar } from '../format.js';
import { checkQortalName } from '../../shared/qortalName.js';
import {
  WIZARD_STEP_IDS,
  WIZARD_STEP_LABELS,
  completedStepIndexes,
  dateInputValue,
  describeDateRange,
  describeUnsupportedList,
  endOfDayIso,
  migrateWizardForLoad,
  normalizeCompletedSteps,
  startOfDayIso,
  WIZARD_STATE_VERSION,
  type WizardStepId
} from '../../shared/wizard.js';

const STEPS = WIZARD_STEP_IDS.map((id) => WIZARD_STEP_LABELS[id]);

function authModeLabel(mode: string): string {
  if (mode === 'application_password') return 'Application password (recommended)';
  if (mode === 'session') return 'WordPress login session (legacy)';
  return 'Public REST API (no login)';
}

interface DiscoveryInfo {
  batchId: string | null;
  completedAt: string;
  counts: Record<string, number>;
  contentTypes: string[];
  truncated: boolean;
  mode?: 'quick' | 'full' | null;
  scope?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
}

interface ScanTelemetry {
  phase: string;
  message: string;
  completed: number;
  total: number;
  mode: string | null;
  postsScanned: number | null;
  requested: number | null;
  pages: number | null;
  mediaDependencies: number | null;
  termsReferenced: number | null;
  bytesTransferred: number | null;
}

function discoveryFromWizard(wizard: Record<string, unknown>): DiscoveryInfo | null {
  const value = wizard.discovery;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const counts = record.counts && typeof record.counts === 'object' && !Array.isArray(record.counts)
    ? Object.fromEntries(Object.entries(record.counts as Record<string, unknown>).map(([key, raw]) => [key, Number(raw) || 0]))
    : {};
  return {
    batchId: typeof record.batchId === 'string' ? record.batchId : null,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : '',
    counts,
    contentTypes: Array.isArray(record.contentTypes) ? record.contentTypes.map(String) : [],
    truncated: record.truncated === true,
    mode: record.mode === 'quick' || record.mode === 'full' ? record.mode : null,
    scope: record.scope && typeof record.scope === 'object' && !Array.isArray(record.scope) ? record.scope as Record<string, unknown> : null,
    metrics: record.metrics && typeof record.metrics === 'object' && !Array.isArray(record.metrics) ? record.metrics as Record<string, unknown> : null
  };
}

function scopeNumber(scope: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = Number(scope?.[key]);
  return Number.isFinite(value) ? value : null;
}

function totalAvailableLabel(scope: Record<string, unknown> | null | undefined): string {
  const total = scope?.totalAvailable;
  if (!total || typeof total !== 'object' || Array.isArray(total)) return 'unknown until the first response';
  const entries = Object.entries(total as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => key + ' ' + (Number.isFinite(Number(value)) ? Number(value) : '?'));
  return entries.length > 0 ? entries.join(' · ') : 'unknown until the first response';
}

function underReturnNotice(scope: Record<string, unknown> | null | undefined): string | null {
  if (!scope || scope.underReturned !== true) return null;
  const scanned = Number(scope.scanned);
  const requested = Number(scope.requested);
  const available = Number(scope.availableTotal);
  if (![scanned, requested, available].every(Number.isFinite)) return null;
  return 'The source returned ' + scanned + ' usable item(s) for the requested window (up to ' + requested +
    ') although it advertises ' + available + ' matching item(s). QMS indexed exactly ' + scanned +
    '; nothing was dropped locally.';
}

function planFailureFrom(result: PlanCreateResult): { code: string; message: string; details?: Record<string, unknown> } | null {
  if (result.status !== 'failed') return null;
  const error = result.error ?? {};
  return {
    code: typeof error.code === 'string' ? error.code : 'PLAN_FAILED',
    message: typeof error.message === 'string' ? error.message : 'The plan could not be created.',
    details: error.details && typeof error.details === 'object' ? error.details as Record<string, unknown> : undefined
  };
}

function selectedCountOf(plan: PlanDocument | null, preview: PlanCreateResult | null): number {
  return Number(plan?.stats?.selected ?? preview?.stats?.selected ?? 0);
}

function planDiagnosticsOf(plan: PlanDocument | null, preview: PlanCreateResult | null): FilterDiagnostics | null {
  return (preview?.filterDiagnostics ?? plan?.filterDiagnostics ?? plan?.selection?.filterDiagnostics ?? null) as FilterDiagnostics | null;
}

interface WizardProps {
  project: ProjectDocument;
  adapters: AdapterInfo[];
  settings: DesktopSettings;
  onClose: () => Promise<void>;
  onComplete: (projectId: string, planId: string) => Promise<void>;
}

function storedWizard(project: ProjectDocument): Partial<WizardState> {
  const settings = (project.settings ?? {}) as Record<string, unknown>;
  const value = settings.desktopWizard;
  if (value && typeof value === 'object') return value as Partial<WizardState>;
  return {};
}

function defaultWizard(project: ProjectDocument, adapters: AdapterInfo[]): WizardState {
  const rawStored = storedWizard(project);
  const migrated = migrateWizardForLoad(rawStored);
  const stored = migrated.wizard as Partial<WizardState> & Record<string, unknown>;
  const source = (project.source ?? {}) as Record<string, unknown>;
  const target = (project.target ?? {}) as Record<string, unknown>;
  const projectSettings = (project.settings ?? {}) as Record<string, unknown>;
  const storedWebsite = (stored.website ?? {}) as Record<string, unknown>;
  const projectWebsite = (projectSettings.website ?? {}) as Record<string, unknown>;
  const website = { ...projectWebsite, ...storedWebsite };
  const theme = (website.theme ?? {}) as Record<string, unknown>;
  const colors = (theme.colors ?? {}) as Record<string, unknown>;
  return {
    step: typeof stored.step === 'number' ? stored.step : 1,
    completedSteps: normalizeCompletedSteps(stored.completedSteps),
    wizardVersion: WIZARD_STATE_VERSION,
    adapterId: stored.adapterId ?? String(source.adapter ?? adapters[0]?.id ?? 'wordpress'),
    sourceUrl: stored.sourceUrl ?? String(source.baseUrl ?? ''),
    authMode: stored.authMode ?? 'none',
    connection: stored.connection ?? null,
    targetQdnName: stored.targetQdnName ?? String(target.qdnName ?? ''),
    siteTitle: stored.siteTitle ?? String(target.siteName ?? project.name ?? ''),
    siteDescription: stored.siteDescription ?? String(target.siteDescription ?? ''),
    website: {
      cms: String(website.cms ?? 'generic-cms'),
      service: String(website.service ?? 'APP').toUpperCase() === 'WEBSITE' ? 'WEBSITE' : 'APP',
      tagline: String(website.tagline ?? ''),
      accent: String(colors.accent ?? '#4da3ff')
    },
    preferences: (stored.preferences ?? {}) as Record<string, unknown>,
    planId: (stored.planId as string | null | undefined) ?? null,
    updatedAt: stored.updatedAt ?? new Date().toISOString()
  };
}

function numberValue(value: unknown, fallback: number): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : String(fallback);
}

function gibToBytes(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed * 1024 * 1024 * 1024) : 0;
}

function mibToBytes(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed * 1024 * 1024) : 1;
}

export function Wizard({ project, adapters, settings, onClose, onComplete }: WizardProps) {
  const initial = useMemo(() => defaultWizard(project, adapters), [project, adapters]);
  const initialService = String(initial.website?.service ?? 'APP').toUpperCase();
  const migrationNeeded = useMemo(() => migrateWizardForLoad(storedWizard(project)).changed, [project]);
  const migrationSaved = useRef(false);
  const previewFlight = useRef(createPlanPreviewFlight<PlanCreateResult>()).current;
  const preferences = (initial.preferences ?? {}) as Record<string, unknown>;
  const [step, setStep] = useState(Math.max(1, Math.min(5, initial.step)));
  const [completed, setCompleted] = useState<WizardStepId[]>(initial.completedSteps);
  const [adapterId, setAdapterId] = useState(initial.adapterId);
  const [sourceUrl, setSourceUrl] = useState(initial.sourceUrl);
  const [authMode, setAuthMode] = useState(initial.authMode);
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [connection, setConnection] = useState<SourceValidationResult | null>((initial.connection as SourceValidationResult | null) ?? null);
  const [targetName, setTargetName] = useState(initial.targetQdnName);
  const [siteTitle, setSiteTitle] = useState(initial.siteTitle);
  const [siteDescription, setSiteDescription] = useState(initial.siteDescription);
  const [cmsTemplate, setCmsTemplate] = useState(String(initial.website?.cms ?? 'generic-cms'));
  const [cmsService, setCmsService] = useState(String(initial.website?.service ?? 'APP').toUpperCase());
  const [siteTagline, setSiteTagline] = useState(String(initial.website?.tagline ?? ''));
  const [siteAccent, setSiteAccent] = useState(String(initial.website?.accent ?? '#4da3ff'));
  const [batchSize, setBatchSize] = useState(numberValue(preferences.batchSize, 15));
  const [contentTypes, setContentTypes] = useState<string[]>(Array.isArray(preferences.contentTypes) ? preferences.contentTypes as string[] : ['post', 'page']);
  const [after, setAfter] = useState(String(preferences.after ?? ''));
  const [before, setBefore] = useState(String(preferences.before ?? ''));
  const [includeReserved, setIncludeReserved] = useState(Boolean(preferences.includeReserved));
  const [allowExternal, setAllowExternal] = useState(Boolean(preferences.allowExternalMedia));
  const [includeUnreferencedAttachments, setIncludeUnreferencedAttachments] = useState(Boolean(preferences.includeUnreferencedAttachments));
  const [concurrency, setConcurrency] = useState(numberValue(preferences.concurrency, 4));
  const [reserveGib, setReserveGib] = useState(numberValue(preferences.reserveGib, 10));
  const [maxRunGib, setMaxRunGib] = useState(numberValue(preferences.maxRunGib, 2));
  const [maxFileMib, setMaxFileMib] = useState(numberValue(preferences.maxFileMib, 256));
  const [maxFiles, setMaxFiles] = useState(numberValue(preferences.maxFiles, 500));
  const [unknownPolicy, setUnknownPolicy] = useState(String(preferences.unknownPolicy ?? 'reject'));
  const [planPreview, setPlanPreview] = useState<PlanCreateResult | null>(null);
  const [planDocument, setPlanDocument] = useState<PlanDocument | null>(null);
  const [planDiagnostics, setPlanDiagnostics] = useState<FilterDiagnostics | null>(null);
  const [planFailure, setPlanFailure] = useState<{ code: string; message: string; details?: Record<string, unknown> } | null>(null);
  const [diskPreview, setDiskPreview] = useState<Record<string, unknown> | null>(null);
  const [scan, setScan] = useState<DiscoveryInfo | null>(discoveryFromWizard(preferences));
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  // The wizard-level stepError renders above the stepper. Step 4 is long, so a
  // scan failure used to be invisible while the owner looked at the controls
  // that had just failed. Keep a scan-specific error next to those controls.
  const [scanError, setScanError] = useState('');
  const [scanMode, setScanMode] = useState<'quick' | 'full'>('quick');
  const [quickScanLimit, setQuickScanLimit] = useState(100);
  const [fullScanAcknowledged, setFullScanAcknowledged] = useState(false);
  const [scanConfirmRequired, setScanConfirmRequired] = useState(false);
  const [scanRunId, setScanRunId] = useState<string | null>(null);
  const [scanState, setScanState] = useState<string | null>(null);
  const [scanTelemetry, setScanTelemetry] = useState<ScanTelemetry | null>(null);
  const [interruptedScan, setInterruptedScan] = useState<RecoveryCandidate | null>(null);
  const [resumingScan, setResumingScan] = useState(false);
  const [planPhase, setPlanPhase] = useState<{ phase: string; completed: number; total: number; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [stepError, setStepError] = useState('');

  const adapter = useMemo(() => adapters.find((entry) => entry.id === adapterId) ?? adapters[0] ?? null, [adapters, adapterId]);
  const authModes = adapter?.capabilities.authentication ?? ['none'];
  const availableContentTypes = adapter?.capabilities.contentTypes ?? ['post', 'page'];
  const keyringAvailable = Boolean(settings.keyring?.available);

  useEffect(() => {
    if (authModes.length > 0 && !authModes.includes(authMode)) setAuthMode(authModes[0]);
  }, [authModes, authMode]);

  // The step effect is the single trigger for the first Plan Review load.
  // Navigation handlers must not call loadPreview() a second time; the helper
  // itself also coalesces any concurrent caller into one plan.create request.
  useEffect(() => {
    if (step === 5 && !planPreview && !previewing) void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => () => previewFlight.reset(), [previewFlight]);

  useEffect(() => {
    if (!migrationNeeded || migrationSaved.current) return;
    migrationSaved.current = true;
    void persist(step, completed).catch((migrationError) => setError(migrationError));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [migrationNeeded]);

  useEffect(() => {
    const unsubscribe = api().events.on((payload) => {
      const event = payload as QmsEvent;
      if (event.project_id !== project.id) return;
      const kind = String(event.details?.kind ?? '');
      if (event.type === 'operation_started' && kind === 'source.discover') {
        setScanRunId(event.run_id ?? null);
        setScanState('running');
        setScanning(true);
      }
      if (event.run_id && ['operation_completed', 'operation_cancelled', 'operation_failed'].includes(event.type)) {
        if (event.type === 'operation_completed') setScanState('completed');
        else if (event.type === 'operation_cancelled') setScanState(event.code === 'OPERATION_PAUSED' ? 'paused' : 'cancelled');
        else setScanState('failed');
      }
      if (event.progress && (event.type === 'progress_updated' || event.type === 'operation_started')) {
        const total = Number(event.progress.total ?? 0);
        const completed = Number(event.progress.completed ?? 0);
        const details = event.details ?? {};
        const scanRelated = details.mode === 'quick' || details.mode === 'full' ||
          ['connect', 'select', 'terms', 'assets', 'content', 'finalize'].includes(String(event.phase ?? ''));
        if (scanRelated && !['index', 'classify', 'media_estimate', 'prepare'].includes(String(event.phase ?? ''))) {
          setScanTelemetry({
            phase: String(event.phase ?? 'scan'),
            message: event.message ?? '',
            completed,
            total,
            mode: details.mode === 'quick' || details.mode === 'full' ? details.mode : null,
            postsScanned: Number.isFinite(Number(details.postsScanned ?? details.contentProcessed ?? details.scanned))
              ? Number(details.postsScanned ?? details.contentProcessed ?? details.scanned)
              : null,
            requested: Number.isFinite(Number(details.requested ?? details.contentTotal)) ? Number(details.requested ?? details.contentTotal) : null,
            pages: Number.isFinite(Number(details.pages ?? details.pagesFetched)) ? Number(details.pages ?? details.pagesFetched) : null,
            mediaDependencies: Number.isFinite(Number(details.mediaDependencies)) ? Number(details.mediaDependencies) : null,
            termsReferenced: Number.isFinite(Number(details.termsReferenced)) ? Number(details.termsReferenced) : null,
            bytesTransferred: Number.isFinite(Number(details.bytesTransferred ?? event.progress.bytes)) ? Number(details.bytesTransferred ?? event.progress.bytes) : null
          });
        }
        if (event.phase && ['index', 'classify', 'select', 'media_estimate', 'prepare'].includes(event.phase)) {
          setPlanPhase({ phase: event.phase, completed, total, message: event.message ?? '' });
        } else if (!scanRelated) {
          setScanProgress(event.message ?? ('Scanning: ' + completed + (total > 0 ? '/' + total + ' item(s)' : ' so far')));
        } else {
          setScanProgress(event.message ?? ('Scanning: ' + completed + (total > 0 ? '/' + total + ' item(s)' : ' so far')));
        }
      }
    });
    return unsubscribe;
  }, [project.id]);

  useEffect(() => {
    if (step !== 4) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const status = await api().recovery.status(project.id);
        const candidate = [...status.candidates]
          .filter((entry) => entry.kind === 'source.discover' && entry.resumable && entry.runId)
          .sort((left, right) => String(right.startedAt ?? '').localeCompare(String(left.startedAt ?? '')))[0] ?? null;
        if (!cancelled) setInterruptedScan(candidate);
      } catch {
        if (!cancelled) setInterruptedScan(null);
      }
    })();
    return () => { cancelled = true; };
  }, [project.id, step, scan?.batchId, scanState]);

  function wizardState(
    nextStep = step,
    nextCompleted = completed,
    scanOverride: DiscoveryInfo | null | undefined = undefined,
    planOverride: PlanCreateResult | null | undefined = undefined
  ): WizardState {
    const effectiveScan = scanOverride === undefined ? scan : scanOverride;
    return {
      step: nextStep,
      completedSteps: nextCompleted,
      wizardVersion: WIZARD_STATE_VERSION,
      adapterId,
      sourceUrl,
      authMode,
      connection: connection ? {
        status: connection.status,
        report: connection.report ? {
          ok: connection.report.ok,
          site: connection.report.site ?? null,
          counts: connection.report.counts ?? {},
          contentTypes: connection.report.contentTypes ?? [],
          warnings: connection.report.warnings ?? []
        } : null,
        error: connection.error ? { code: connection.error.code, message: connection.error.message } : null
      } : null,
      targetQdnName: targetName,
      siteTitle,
      siteDescription,
      website: {
        cms: cmsTemplate,
        service: cmsService,
        tagline: siteTagline,
        accent: siteAccent
      },
      preferences: {
        batchSize: Number(batchSize),
        contentTypes,
        after,
        before,
        includeReserved,
        allowExternalMedia: allowExternal,
        includeUnreferencedAttachments,
        concurrency: Number(concurrency),
        reserveGib: Number(reserveGib),
        maxRunGib: Number(maxRunGib),
        maxFileMib: Number(maxFileMib),
        maxFiles: Number(maxFiles),
        unknownPolicy,
        // Never persist an undefined member: JSON drops it, but the IPC
        // validator used to reject undefined before the write. Omit the key
        // entirely when there is no cached discovery result.
        ...(effectiveScan ? { discovery: effectiveScan } : {})
      },
      planId: planOverride?.planId ?? planPreview?.planId ?? initial.planId ?? null,
      updatedAt: new Date().toISOString()
    };
  }

  async function persist(
    nextStep = step,
    nextCompleted = completed,
    scanOverride: DiscoveryInfo | null | undefined = undefined,
    planOverride: PlanCreateResult | null | undefined = undefined
  ) {
    await api().projects.saveWizard(project.id, wizardState(nextStep, nextCompleted, scanOverride, planOverride));
  }

  async function goTo(nextStep: number) {
    if (nextStep < 1 || nextStep > 5) return;
    setError(null);
    setStepError('');
    setStep(nextStep);
    try {
      await persist(nextStep, completed);
    } catch (saveError) {
      setError(saveError);
    }
  }

  function validateStep(current: number): string {
    if (current === 1) {
      if (!adapter) return 'Select a source adapter.';
      if (!adapter.capabilities.contentTypes.includes('post')) return 'This adapter does not advertise post support.';
      return '';
    }
    if (current === 2) {
      if (!/^https?:\/\//i.test(sourceUrl.trim())) return 'Enter a full http:// or https:// WordPress URL.';
      if (!connection) return 'Test the connection before continuing.';
      if (connection.status !== 'completed' || !connection.report?.ok) return 'The source connection has not been validated successfully.';
      if (authMode !== 'none' && connection.report.auth && !connection.report.auth.authenticated) return 'Authentication was not verified.';
      return '';
    }
    if (current === 3) {
      if (!targetName.trim()) return 'A Qortal name is required for planning.';
      const checked = checkQortalName(targetName);
      if (!checked.ok) return checked.message;
      if (!siteTitle.trim()) return 'A website title is required.';
      if (cmsTemplate === 'generic-cms' && !siteTagline.trim()) return 'A tagline is required when the Generic CMS is selected.';
      return '';
    }
    if (current === 4) {
      const batch = Number(batchSize);
      if (!Number.isInteger(batch) || batch < 1 || batch > 1000) return 'Batch size must be an integer between 1 and 1000.';
      if (contentTypes.length === 0) return 'Select at least one content type.';
      const reserve = Number(reserveGib);
      const run = Number(maxRunGib);
      const file = Number(maxFileMib);
      if (!Number.isFinite(reserve) || reserve < 0) return 'Minimum free disk must be zero or more.';
      if (!Number.isFinite(run) || run < 0) return 'Maximum bytes per run must be zero or more.';
      if (!Number.isFinite(file) || file <= 0) return 'Maximum bytes per file must be greater than zero.';
      if (run > 0 && file > run * 1024) return 'Per-file limit cannot exceed the per-run limit.';
      if (unknownPolicy === 'estimate' && file <= 0) return 'The estimate policy needs a positive per-file size.';
      if (after && before && Date.parse(after) > Date.parse(before)) {
        return 'The "published after" date must not be later than "published before".';
      }
      return '';
    }
    if (current === 5) {
      if (!planPreview) return 'Load the plan review first.';
      if (planFailure) return 'Planning failed (' + planFailure.code + '): ' + planFailure.message;
      if (planPreview.status === 'blocked') return 'The plan is blocked. Adjust preferences before approval.';
      if (planPreview.status !== 'completed') return 'The plan did not complete successfully. Review the error above and refresh the preview.';
      if (!planPreview.planId || planDocument?.status !== 'ready') return 'No ready plan exists. Refresh the preview before approving.';
      if (selectedCountOf(planDocument, planPreview) === 0) {
        return 'No content matches the current filters, so there is nothing to approve. Adjust the published-date filters or content types.';
      }
      return '';
    }
    return '';
  }

  function numericCounts(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const number = Number(raw);
      out[key] = Number.isFinite(number) ? number : 0;
    }
    return out;
  }

  async function hasCompletedDiscovery(): Promise<boolean> {
    try {
      const runs = await api().runs.list(project.id);
      const completed = runs.some((run) => run.kind === 'source.discover' && run.state === 'completed');
      if (completed) return true;
    } catch {
      // Fall through to the persisted wizard hint; the plan itself remains the
      // authoritative check and will return SOURCE_DISCOVERY_REQUIRED.
    }
    return Boolean(scan?.batchId);
  }

  function discoveryInfoFrom(result: Record<string, unknown>): DiscoveryInfo {
    const report = result.report && typeof result.report === 'object' ? result.report as Record<string, unknown> : {};
    const summary = result.summary && typeof result.summary === 'object' ? result.summary as Record<string, unknown> : {};
    const scope = result.scope && typeof result.scope === 'object' && !Array.isArray(result.scope)
      ? result.scope as Record<string, unknown>
      : report.scope && typeof report.scope === 'object' && !Array.isArray(report.scope)
        ? report.scope as Record<string, unknown>
        : null;
    const metrics = result.metrics && typeof result.metrics === 'object' && !Array.isArray(result.metrics)
      ? result.metrics as Record<string, unknown>
      : report.metrics && typeof report.metrics === 'object' && !Array.isArray(report.metrics)
        ? report.metrics as Record<string, unknown>
        : null;
    return {
      batchId: typeof result.batchId === 'string' ? result.batchId : null,
      completedAt: new Date().toISOString(),
      counts: numericCounts(report.counts ?? summary.counts),
      contentTypes,
      truncated: Boolean(summary.truncated ?? report.truncated),
      mode: result.mode === 'quick' || result.mode === 'full' ? result.mode : report.mode === 'quick' || report.mode === 'full' ? report.mode : null,
      scope,
      metrics
    };
  }

  function startScanTracking(): () => void {
    if (typeof window === 'undefined') return () => {};
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const runs = await api().runs.list(project.id);
          const active = runs.find((run) => run.kind === 'source.discover' && run.state === 'running');
          if (active) setScanRunId(active.id);
          const latest = runs.find((run) => run.kind === 'source.discover');
          if (latest?.state) setScanState(latest.state);
        } catch {
          // Polling is advisory; the awaited operation remains authoritative.
        }
      })();
    }, 800);
    return () => window.clearInterval(timer);
  }

  function fullInventoryWorstCasePages(): number | null {
    const counts = (connection?.report?.counts ?? scan?.counts ?? {}) as Record<string, unknown>;
    const posts = Number(counts.posts);
    const pages = Number(counts.pages);
    const categories = Number(counts.categories);
    const tags = Number(counts.tags);
    const media = Number(counts.media);
    if (![posts, pages, categories, tags, media].every(Number.isFinite)) return null;
    return Math.ceil((posts + pages) / 100) + Math.ceil((categories + tags) / 100) + Math.ceil(media / 100);
  }

  function describeScanError(error: unknown): string {
    const code = (error as { code?: string } | null)?.code;
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string' && error.trim() !== ''
        ? error
        : 'unknown error';
    return (code ? code + ': ' : '') + message;
  }

  async function runScan(mode: 'quick' | 'full' = scanMode, { continueAfter = false } = {}): Promise<DiscoveryInfo | null> {
    if (mode === 'full' && !fullScanAcknowledged) {
      const message = 'Full site inventory is a long, explicit operation. Tick the confirmation before starting it.';
      setStepError(message);
      setScanError(message);
      return null;
    }
    const limit = Math.max(1, Math.min(100, Number(quickScanLimit) || 100));
    setScanning(true);
    setScanState('running');
    setScanRunId(null);
    setScanConfirmRequired(false);
    setScanProgress(mode === 'quick'
      ? 'Quick scan: fetching one bounded content page and only referenced dependencies…'
      : 'Full inventory: this can take a long time. Pause and cancel remain available.');
    setError(null);
    setStepError('');
    setScanError('');
    const stopTracking = startScanTracking();
    try {
      const result = await api().sources.discover(project.id, {
        adapterId,
        contentTypes,
        // A quick scan still fetches exactly one content page. Ask for the
        // full page size rather than exactly maxItems: some WordPress APIs
        // (NASA is one) return fewer rows than per_page, and a tiny window
        // then indexes fewer items than the owner asked for. The engine slices
        // the page to maxItems, so only the requested number is indexed.
        perPage: 100,
        mode,
        selection: mode === 'quick'
          ? { perPage: 100, maxPages: 1, maxItems: limit }
          : {},
        includeTerms: true,
        includeAssets: true
      }) as Record<string, unknown>;
      if (result.status === 'paused') {
        setScanState('paused');
        setScanProgress('Scan paused at the last durable checkpoint. Resume it from here or from Recovery.');
        setStepError('');
        setScanError('');
        return null;
      }
      if (result.status === 'cancelled') {
        setScanState('cancelled');
        setScanProgress('Scan cancelled. The project and every completed asset are preserved.');
        setScanError('');
        return null;
      }
      if (result.status !== 'completed') {
        const failure = result.error && typeof result.error === 'object' ? result.error as Record<string, unknown> : {};
        const message = typeof failure.message === 'string' ? failure.message : 'The source scan did not complete.';
        const code = typeof failure.code === 'string' ? failure.code : 'SOURCE_SCAN_FAILED';
        setScanState('failed');
        setStepError('Source scan failed (' + code + '): ' + message);
        setScanError('Source scan failed (' + code + '): ' + message);
        return null;
      }
      const info = discoveryInfoFrom(result);
      setScan(info);
      setScanState('completed');
      setScanError('');
      setScanProgress(mode === 'quick' ? 'Quick scan complete within its request budget.' : 'Full inventory complete.');
      await persist(step, completed, info);
      if (continueAfter) {
        await next();
      }
      return info;
    } catch (caught) {
      setScanState('failed');
      setError(caught);
      const detail = 'Source scan failed: ' + describeScanError(caught);
      setStepError(detail);
      setScanError(detail);
      return null;
    } finally {
      stopTracking();
      setScanning(false);
    }
  }

  async function resumeInterruptedScan(): Promise<DiscoveryInfo | null> {
    if (!interruptedScan?.runId) return null;
    setResumingScan(true);
    setScanning(true);
    setScanState('running');
    setScanRunId(null);
    setScanProgress('Resuming from the durable checkpoint…');
    setStepError('');
    setScanError('');
    const stopTracking = startScanTracking();
    try {
      const resumed = await api().recovery.resume(project.id, { runId: interruptedScan.runId });
      const result = resumed.result && typeof resumed.result === 'object' ? resumed.result as Record<string, unknown> : {};
      if (result.status === 'paused') {
        setScanState('paused');
        setScanProgress('Resume paused again at a safe boundary. No completed work was lost.');
        return null;
      }
      if (result.status !== 'completed') {
        const failure = result.error && typeof result.error === 'object' ? result.error as Record<string, unknown> : {};
        const detail = 'Resume did not complete (' + String(failure.code ?? 'RECOVERY_NOT_RESUMABLE') + '): ' + String(failure.message ?? 'unknown error');
        setScanState('failed');
        setStepError(detail);
        setScanError(detail);
        return null;
      }
      const info = discoveryInfoFrom(result);
      setScan(info);
      setScanState('completed');
      setInterruptedScan(null);
      setScanError('');
      setScanProgress('Interrupted scan resumed from the checkpoint and completed.');
      await persist(step, completed, info);
      return info;
    } catch (caught) {
      setScanState('failed');
      setError(caught);
      const detail = 'Resume failed: ' + describeScanError(caught);
      setStepError(detail);
      setScanError(detail);
      return null;
    } finally {
      stopTracking();
      setScanning(false);
      setResumingScan(false);
    }
  }

  async function pauseScan(): Promise<void> {
    if (!scanRunId) return;
    try {
      await api().runs.pause(project.id, scanRunId);
      setScanProgress('Pause requested. Finalizing the current safe boundary…');
    } catch (pauseError) {
      const detail = 'Pause failed: ' + describeScanError(pauseError);
      setStepError(detail);
      setScanError(detail);
    }
  }

  async function cancelScan(): Promise<void> {
    if (!scanRunId) return;
    try {
      await api().runs.cancel(project.id, scanRunId);
      setScanProgress('Cancel requested. The project, checkpoints and verified assets are preserved.');
    } catch (cancelError) {
      const detail = 'Cancel failed: ' + describeScanError(cancelError);
      setStepError(detail);
      setScanError(detail);
    }
  }

  function applyPlanResult(result: PlanCreateResult) {
    setPlanPreview(result);
    setPlanDocument(result.plan ?? null);
    setPlanDiagnostics(planDiagnosticsOf(result.plan ?? null, result));
    setPlanFailure(planFailureFrom(result));
  }

  async function next() {
    const message = validateStep(step);
    if (message) { setStepError(message); return; }
    setBusy(true);
    setError(null);
    try {
      if (step === 1) {
        await api().projects.update(project.id, { source: { adapter: adapterId } });
      }
      if (step === 2) {
        await api().projects.update(project.id, {
          source: { adapter: adapterId, baseUrl: sourceUrl.trim() }
        });
      }
      if (step === 3) {
        const target = await api().identity.validateTarget({ qdnName: targetName });
        await api().projects.update(project.id, {
          target: { qdnName: target.qdnName, siteName: siteTitle.trim(), siteDescription: siteDescription.trim() },
          settings: {
            website: {
              cms: cmsTemplate,
              service: cmsService,
              tagline: siteTagline.trim(),
              theme: { colors: { accent: siteAccent } }
            }
          }
        });
      }
      let scanOverride: DiscoveryInfo | null | undefined;
      if (step === 4) {
        await savePreferences();
        if (!(await hasCompletedDiscovery())) {
          // Never launch a long or unbounded source crawl from 'Continue'.
          // Show the exact scope and make the owner confirm it explicitly.
          setScanConfirmRequired(true);
          setStepError(scanMode === 'quick'
            ? 'Review the bounded quick-scan scope below, then run it explicitly. QMS will not start a full-site crawl automatically.'
            : 'Full site inventory is a long operation. Confirm it explicitly below before it starts.');
          return;
        }
      }
      const nextStep = Math.min(5, step + 1);
      const currentId = WIZARD_STEP_IDS[step - 1];
      const nextCompleted: WizardStepId[] = completed.includes(currentId) ? completed : [...completed, currentId];
      setCompleted(nextCompleted);
      setStep(nextStep);
      await persist(nextStep, nextCompleted, scanOverride);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setError(null);
    setConnection(null);
    try {
      const result = await api().sources.validate(project.id, {
        adapterId,
        source: { baseUrl: sourceUrl.trim() },
        auth: authMode === 'application_password'
          ? { mode: authMode, username, appPassword }
          : authMode === 'session'
            ? { mode: authMode, username, password }
            : { mode: 'none' },
        remember: remember && keyringAvailable
      });
      setConnection(result);
      if (result.status !== 'completed' || !result.report?.ok) {
        setStepError('Connection failed. Review the error and credentials.');
      } else {
        setStepError('');
      }
      await persist(step, completed);
    } catch (connectionError) {
      setError(connectionError);
    } finally {
      setBusy(false);
    }
  }

  function diskOverrides(): Record<string, unknown> {
    return {
      reserveBytes: gibToBytes(reserveGib),
      maxBytesPerRun: gibToBytes(maxRunGib),
      maxFileBytes: mibToBytes(maxFileMib),
      maxFilesPerRun: Number(maxFiles) || 500,
      unknownSizePolicy: unknownPolicy,
      ...(unknownPolicy === 'estimate' ? { unknownSizeBytes: mibToBytes(maxFileMib) } : {})
    };
  }

  async function savePreferences() {
    await api().projects.update(project.id, {
      settings: {
        planning: {
          batchSize: Number(batchSize),
          includeReserved,
          includePages: contentTypes.includes('page')
        },
        disk: diskOverrides(),
        media: {
          allowExternalMedia: allowExternal,
          includeUnreferencedAttachments,
          concurrency: Number(concurrency) || 4
        }
      }
    });
  }

  async function checkDisk() {
    setBusy(true);
    setError(null);
    try {
      const report = await api().disk.check(project.id, { disk: diskOverrides(), knownBytes: 0, unknownCount: 0, metadataBytes: 65536 });
      setDiskPreview(report);
    } catch (diskError) {
      setError(diskError);
    } finally {
      setBusy(false);
    }
  }

  function planOptions(persistPlan: boolean): Record<string, unknown> {
    return {
      batchSize: Number(batchSize),
      filters: {
        contentTypes,
        ...(after ? { after } : {}),
        ...(before ? { before } : {})
      },
      planning: { includeReserved, includePages: contentTypes.includes('page') },
      disk: diskOverrides(),
      media: { allowExternalMedia: allowExternal, includeUnreferencedAttachments, concurrency: Number(concurrency) || 4 },
      estimateMedia: true,
      persist: persistPlan
    };
  }

  function loadPreview(): Promise<void> {
    return previewFlight.load({
      onStart: () => {
        setPreviewing(true);
        setError(null);
        setPlanFailure(null);
      },
      task: async () => {
        if (!(await hasCompletedDiscovery())) {
          const info = await runScan();
          if (!info) return null;
        }
        return api().plans.create(project.id, planOptions(false));
      },
      onSuccess: (result) => {
        applyPlanResult(result);
        // A successful preview must not leave an older error (for example a
        // rejected concurrent plan.create) next to a ready plan.
        setError(null);
      },
      onError: (previewError) => {
        setError(previewError);
        setPlanFailure({
          code: (previewError as { code?: string } | null)?.code ?? 'PLAN_PREVIEW_FAILED',
          message: previewError instanceof Error ? previewError.message : 'The plan preview could not be loaded.'
        });
      },
      onSettled: () => setPreviewing(false)
    });
  }

  async function approve() {
    const message = validateStep(5);
    if (message) { setStepError(message); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await api().plans.create(project.id, planOptions(true));
      applyPlanResult(result);
      if (result.status !== 'completed' || !result.planId || result.plan?.status !== 'ready') {
        const failure = planFailureFrom(result);
        setStepError(failure
          ? 'The plan was not approved. ' + failure.code + ': ' + failure.message
          : 'The plan did not become ready (' + result.status + '). Nothing was approved for preparation.');
        return;
      }
      const nextCompleted: WizardStepId[] = completed.includes('plan') ? completed : [...completed, 'plan'];
      setCompleted(nextCompleted);
      await persist(5, nextCompleted);
      await onComplete(project.id, result.planId);
    } catch (approveError) {
      setError(approveError);
    } finally {
      setBusy(false);
    }
  }

  const identity = (project.identity ?? {}) as Record<string, unknown>;
  const completedIndexes = completedStepIndexes(completed);
  const selectedCount = selectedCountOf(planDocument, planPreview);
  const planReady = Boolean(
    planPreview &&
    planPreview.status === 'completed' &&
    planPreview.planId &&
    planDocument?.status === 'ready'
  );
  const canApprove = planReady && selectedCount > 0 && !planFailure;
  const approveBlockReason = planFailure
    ? 'Planning failed (' + planFailure.code + '): ' + planFailure.message
    : !planPreview
      ? 'Load the plan review before approving.'
      : planPreview.status === 'blocked'
        ? 'The plan is blocked by a safety check. Adjust the filters or disk limits.'
        : planPreview.status !== 'completed'
          ? 'The plan did not complete; nothing can be approved.'
          : !planReady
            ? 'No ready plan exists. Refresh the preview.'
            : selectedCount === 0
              ? 'No content matches the current filters, so nothing can be approved.'
              : '';
  const underReturnMessage = underReturnNotice(scan?.scope);
  const serviceChanged = cmsService !== initialService;
  const readOnlyReasons = planDocument?.warnings?.filter((warning) => warning.code === 'READ_ONLY').length ?? 0;
  void readOnlyReasons;

  return (
    <div className="wizard stack">
      <div className="row between wrap gap">
        <div>
          <p className="eyebrow">Project setup</p>
          <h1>{project.name}</h1>
        </div>
        <button className="ghost" onClick={() => void onClose()}>Back to dashboard</button>
      </div>

      <ol className="stepper">
        {STEPS.map((label, index) => {
          const number = index + 1;
          const stepId = WIZARD_STEP_IDS[index];
          const done = completed.includes(stepId);
          const clickable = number <= Math.max(1, ...completedIndexes.map((value) => value + 1));
          return (
            <li key={label} className={number === step ? 'active' : done ? 'done' : ''}>
              <button disabled={!clickable} onClick={() => void goTo(number)}>
                <span className="step-number">{done ? '✓' : number}</span>
                <span>{label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <ErrorText error={error} />
      {stepError && <Alert tone="bad" title="Check this step">{stepError}</Alert>}

      {step === 1 && (
        <Card title="Choose the source CMS" subtitle="The wizard reads capabilities from the engine registry; React does not hardcode adapter behavior.">
          <div className="choice-grid">
            {adapters.map((entry) => (
              <button key={entry.id} className={'choice ' + (adapterId === entry.id ? 'selected' : '')} onClick={() => setAdapterId(entry.id)} type="button">
                <strong>{entry.displayName}</strong>
                <span className="muted">v{entry.version} · {entry.contract}</span>
                <span className="small">Content: {entry.capabilities.contentTypes.join(', ') || 'none'}</span>
                <span className="small">Auth: {entry.capabilities.authentication.join(', ')}</span>
              </button>
            ))}
          </div>
          {adapter && (
            <div className="capability-box stack-sm">
              <strong>Reported capabilities</strong>
              <div className="row wrap gap"><span>Terms: {adapter.capabilities.terms.join(', ') || 'none'}</span><span>States: {adapter.capabilities.states.join(', ') || 'none'}</span></div>
              <div className="row wrap gap"><span>Assets: {Object.entries(adapter.capabilities.assets).filter(([, enabled]) => enabled).map(([key]) => key).join(', ') || 'none'}</span></div>
              <div className="row wrap gap"><span>Unsupported: {describeUnsupportedList(adapter.capabilities.unsupported).join(', ') || 'none reported'}</span></div>
            </div>
          )}
        </Card>
      )}

      {step === 2 && (
        <Card title="Connect to WordPress" subtitle="Validation goes through the engine adapter. Credentials are never written to project files or logs.">
          <div className="grid-2">
            <Field label="WordPress site URL" hint="The REST API root is discovered automatically.">
              <input value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setConnection(null); }} placeholder="https://example.org" />
            </Field>
            <Field
              label="Authentication mode"
              hint="Public posts and pages usually need no login. Drafts, private items and media in a protected library need an application password."
            >
              <select value={authMode} onChange={(event) => { setAuthMode(event.target.value); setConnection(null); }}>
                {authModes.map((mode) => <option key={mode} value={mode}>{authModeLabel(mode)}</option>)}
              </select>
            </Field>
            <div className="wide capability-box" data-testid="auth-guidance">
              <strong>How WordPress access works</strong>
              <ul className="small">
                <li><strong>Public REST API (no login)</strong> — reads published content from <code>/wp-json/wp/v2</code>. No credentials are stored.</li>
                <li><strong>Application password (recommended)</strong> — WordPress generates a revocable password for this app in Users → Profile. It is different from your normal login password and can be revoked at any time.</li>
                <li><strong>Login session (legacy)</strong> — some hosts disable it or block it with a security plugin. Prefer an application password when drafts must be read.</li>
                <li>The desktop app never exposes your WordPress site or its private APIs to Qortal or the internet.</li>
              </ul>
            </div>
            {authMode !== 'none' && (
              <Field label="Username">
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
              </Field>
            )}
            {authMode === 'application_password' && (
              <Field label="Application password" hint="Create one in WordPress Users → Profile → Application Passwords. Used for this session; stored only in the keyring when selected.">
                <input type="password" value={appPassword} onChange={(event) => setAppPassword(event.target.value)} autoComplete="current-password" />
              </Field>
            )}
            {authMode === 'session' && (
              <Field label="WordPress login password" hint="Session login through the WordPress login endpoint; not the application password. Some hosts disable this.">
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
              </Field>
            )}
            <div className="wide row wrap gap">
              <label className="checkbox">
                <input type="checkbox" checked={remember} disabled={!keyringAvailable} onChange={(event) => setRemember(event.target.checked)} />
                Remember credentials in the Linux keyring
              </label>
              {!keyringAvailable && <span className="small warn-text">No keyring detected: credentials stay in memory for this session only.</span>}
              {keyringAvailable && <span className="small muted">Stored through secret-tool/libsecret; never in a project file.</span>}
            </div>
            <div className="wide row gap">
              <button onClick={() => void testConnection()} disabled={busy || !sourceUrl.trim()} type="button">Test connection</button>
              {connection && <Badge tone={connection.status === 'completed' && connection.report?.ok ? 'good' : 'bad'}>{connection.status}</Badge>}
            </div>
          </div>

          {connection?.report && (
            <div className="stack-sm connection-report" data-testid="connection-report">
              <h3>{connection.report.site?.name ?? 'Connected site'}</h3>
              <p className="muted">{connection.report.site?.url ?? sourceUrl}</p>
              <div className="row wrap gap">
                <span>Auth: {connection.report.auth?.mode} ({connection.report.auth?.authenticated ? 'verified' : 'not verified'})</span>
                <span>Content types: {(connection.report.contentTypes ?? []).join(', ') || 'unknown'}</span>
              </div>
              <div className="row wrap gap">
                {Object.entries(connection.report.counts ?? {}).map(([key, value]) => <span key={key} className="pill">{key}: {formatScalar(value)}</span>)}
              </div>
              {describeUnsupportedList(connection.report.unsupported).length > 0 && (
                <div className="small muted" data-testid="unsupported-features">
                  Unsupported features:
                  <ul>
                    {describeUnsupportedList(connection.report.unsupported).map((entry, index) => <li key={String(index)}>{entry}</li>)}
                  </ul>
                </div>
              )}
              {(connection.report.warnings ?? []).length > 0 && (
                <ul className="small warn-text">
                  {(connection.report.warnings ?? []).map((warning, index) => <li key={String(index)}>{warning.code}: {warning.message}</li>)}
                </ul>
              )}
            </div>
          )}
          {connection?.error && <Alert tone="bad" title={connection.error.code}>{connection.error.message}</Alert>}
        </Card>
      )}

      {step === 3 && (
        <Card title="Qortal destination" subtitle="Local validation only. Remote name ownership and collisions are Phase 5 responsibilities.">
          <div className="grid-2">
            <Field label="Target Qortal name" hint="Exact registered name: 3–40 UTF-8 bytes. Unicode letters and single internal spaces are valid.">
              <input value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="My Qortal Name" />
            </Field>
            <Field label="Website title">
              <input value={siteTitle} onChange={(event) => setSiteTitle(event.target.value)} />
            </Field>
            <Field label="Tagline" hint="Shown by the Generic CMS under the site title.">
              <input value={siteTagline} onChange={(event) => setSiteTagline(event.target.value)} placeholder="Independent publishing on Qortal" />
            </Field>
            <Field label="Website description">
              <textarea value={siteDescription} onChange={(event) => setSiteDescription(event.target.value)} rows={3} />
            </Field>
            <Field label="Website template" hint="The default Generic CMS is published as an application bundle with this project.">
              <select value={cmsTemplate} onChange={(event) => setCmsTemplate(event.target.value)}>
                <option value="generic-cms">Generic CMS (recommended)</option>
                <option value="none">Content only (no website bundle)</option>
              </select>
            </Field>
            <Field label="Website hosting service" hint="APP and WEBSITE are separate QDN deployments even under the same registered name.">
              <select value={cmsService} onChange={(event) => setCmsService(event.target.value)}>
                <option value="APP">APP — application bundle (recommended for the Generic CMS)</option>
                <option value="WEBSITE">WEBSITE — classic QDN website</option>
              </select>
            </Field>
            <Field label="Accent colour" hint="Used by the Generic CMS theme.">
              <input value={siteAccent} onChange={(event) => setSiteAccent(event.target.value)} placeholder="#4da3ff" />
            </Field>
            <div className="wide" data-testid="service-safety">
              <Alert tone={serviceChanged ? 'warn' : 'info'} title={serviceChanged ? 'Hosting service changed' : 'APP and WEBSITE are separate deployments'}>
                <p>
                  A Qortal name can host both an APP and a WEBSITE, but they are different deployments with different QDN identifiers.
                  QMS never overwrites an existing deployment: a resource is only updated when its exact service, name and identifier are republished by this project.
                </p>
                <p>
                  Changing the service after preparation creates a second site bundle under the same name instead of modifying the existing one.
                  {serviceChanged ? ' You changed ' + initialService + ' to ' + cmsService + '; the existing ' + initialService + ' deployment is left untouched. ' : ' '}
                  Review the chosen service before publishing.
                </p>
              </Alert>
            </div>
            <div className="stack-sm">
              <strong>Generated site identity</strong>
              <p className="small muted">Created automatically when the project was created. It is immutable and never typed by a user.</p>
              <code>{String(identity.siteId ?? project.siteId ?? 'pending')}</code>
              <code>{String(identity.namespace ?? project.siteNamespace ?? 'pending')}</code>
              <details>
                <summary>Advanced details</summary>
                <p className="small muted">QDN identifiers are derived from this site identity and a project namespace. Two projects can target the same Qortal name without colliding.</p>
              </details>
            </div>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="Import preferences" subtitle="Defaults come from the Phase 3 planning and disk safety model. Limits are enforced by the engine.">
          <div className="grid-2">
            <Field
              label="Items prepared per batch"
              hint="How many selected items QMS prepares in this run. It does not limit how many posts your WordPress site has or how many Qortal can hold — after this batch, plan the next one. Default 15; 1 is useful for testing one post."
            >
              <input type="number" min={1} max={1000} value={batchSize} onChange={(event) => setBatchSize(event.target.value)} />
            </Field>
            <div className="wide capability-box" data-testid="selection-counts">
              <strong>Discovered vs scanned vs selected</strong>
              <div className="row wrap gap">
                <span className="pill">Discovered on the site: {(scan?.counts.posts ?? 0) + (scan?.counts.pages ?? 0)} (posts {scan?.counts.posts ?? 0}, pages {scan?.counts.pages ?? 0})</span>
                <span className="pill">Scanned into the local index: {planDocument?.stats.scanned ?? planPreview?.stats?.scanned ?? 0}</span>
                <span className="pill">Selected for this batch: {planDocument?.stats.selected ?? planPreview?.stats?.selected ?? 0}</span>
              </div>
              <p className="small muted">
                A batch selects a subset of the indexed items. "Selected" is the number this run will prepare, not the total available.
              </p>
            </div>
            <div className="stack-sm">
              <span className="field-label">Content types</span>
              {availableContentTypes.map((type) => (
                <label className="checkbox" key={type}>
                  <input type="checkbox" checked={contentTypes.includes(type)} onChange={(event) => {
                    setContentTypes((current) => event.target.checked ? [...new Set([...current, type])] : current.filter((entry) => entry !== type));
                  }} />
                  {type}
                </label>
              ))}
            </div>
            <Field label="Published after" hint="Optional date, UTC, inclusive. Empty means no lower bound.">
              <input type="date" value={dateInputValue(after)} onChange={(event) => setAfter(event.target.value ? startOfDayIso(event.target.value) : '')} />
            </Field>
            <Field label="Published before" hint="Optional date, UTC, inclusive through the end of the selected day.">
              <input type="date" value={dateInputValue(before)} onChange={(event) => setBefore(event.target.value ? endOfDayIso(event.target.value) : '')} />
            </Field>
            <div className="wide small" data-testid="applied-date-filter">
              <strong>Applied published-date filter:</strong> {describeDateRange(after, before)}
              {after && before && Date.parse(after) > Date.parse(before) && (
                <span className="danger-text"> The lower bound is later than the upper bound; this interval can never match content.</span>
              )}
            </div>
            <details className="wide capability-box">
              <summary><strong>Advanced storage, media and recovery settings</strong> — defaults are safe for most sites</summary>
              <div className="grid-2" style={{ marginTop: '0.8rem' }}>
            <Field label="Minimum free disk (GiB)" hint="Reserve kept free on the workspace filesystem.">
              <input type="number" min={0} step={0.5} value={reserveGib} onChange={(event) => setReserveGib(event.target.value)} />
            </Field>
            <Field label="Maximum download per run (GiB)" hint="0 means unlimited.">
              <input type="number" min={0} step={0.5} value={maxRunGib} onChange={(event) => setMaxRunGib(event.target.value)} />
            </Field>
            <Field label="Maximum file size (MiB)">
              <input type="number" min={1} value={maxFileMib} onChange={(event) => setMaxFileMib(event.target.value)} />
            </Field>
            <Field label="Maximum files per run">
              <input type="number" min={1} value={maxFiles} onChange={(event) => setMaxFiles(event.target.value)} />
            </Field>
            <Field label="Unknown-size policy" hint="Unknown is never treated as zero.">
              <select value={unknownPolicy} onChange={(event) => setUnknownPolicy(event.target.value)}>
                <option value="reject">Reject the plan</option>
                <option value="cap">Account at the per-file cap</option>
                <option value="estimate">Account at the per-file cap as an estimate</option>
              </select>
            </Field>
            <Field label="Media concurrency">
              <input type="number" min={1} max={32} value={concurrency} onChange={(event) => setConcurrency(event.target.value)} />
            </Field>
            <label className="checkbox wide">
              <input type="checkbox" checked={allowExternal} onChange={(event) => setAllowExternal(event.target.checked)} />
              Download external media (default is link-only)
            </label>
            <label className="checkbox wide">
              <input type="checkbox" checked={includeReserved} onChange={(event) => setIncludeReserved(event.target.checked)} />
              Re-include reserved items for preparation (recovery; never marks them published)
            </label>
            <label className="checkbox wide">
              <input type="checkbox" checked={includeUnreferencedAttachments} onChange={(event) => setIncludeUnreferencedAttachments(event.target.checked)} />
              Also download media-library attachments the post never references (off by default; can be hundreds of files)
            </label>
              </div>
            </details>
            <div className="wide capability-box" data-testid="source-scan">
              <strong>Source scan</strong>
              <p className="small muted">Choose an explicit scope. Quick scan is the recommended default for a small import; it never enumerates the whole library or every taxonomy term.</p>
              <label className="checkbox wide">
                <input type="radio" name="scan-mode" checked={scanMode === 'quick'} onChange={() => setScanMode('quick')} disabled={scanning} />
                Quick scan — selected batch (recommended)
              </label>
              {scanMode === 'quick' && (
                <div className="stack-sm">
                  <Field label="Index up to (newest matching items)" hint="One REST page, maximum 100. Only taxonomy terms and media dependencies referenced by these items are fetched.">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={quickScanLimit}
                      onChange={(event) => setQuickScanLimit(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
                      disabled={scanning}
                    />
                  </Field>
                  <p className="small">
                    Scope: up to {Math.min(100, Math.max(1, Number(quickScanLimit) || 100))} {contentTypes.join(' / ') || 'content'} item(s) in {Math.max(1, contentTypes.length)} content page request(s), plus bounded lookups for only the referenced terms and media. Source total: {scan?.scope ? totalAvailableLabel(scan.scope) : 'not fetched yet'}.
                  </p>
                  <p className="small muted">
                    This is a hard one-page window. Because of that, QMS requests a full page and keeps only the requested number of items, so a source that returns short pages cannot silently reduce the batch.
                  </p>
                </div>
              )}
              <label className="checkbox wide">
                <input type="radio" name="scan-mode" checked={scanMode === 'full'} onChange={() => setScanMode('full')} disabled={scanning} />
                Full site inventory (explicitly chosen; can be very long)
              </label>
              {scanMode === 'full' && (
                <div className="stack-sm">
                  <p className="small warn-text">
                    Full inventory walks every {contentTypes.join(' / ') || 'content'} item, every category/tag and the whole media library. Worst case: {fullInventoryWorstCasePages() !== null ? fullInventoryWorstCasePages() + ' API page(s)' : 'unknown until the source reports totals'}.
                  </p>
                  <label className="checkbox wide">
                    <input type="checkbox" checked={fullScanAcknowledged} onChange={(event) => setFullScanAcknowledged(event.target.checked)} disabled={scanning} />
                    I understand this can crawl the entire site before any content is prepared.
                  </label>
                </div>
              )}
              {scanConfirmRequired && !scanning && (
                <div className="wide small warn-text" data-testid="scan-confirmation">
                  Scan scope is not confirmed yet. Press <strong>Confirm quick scan and continue</strong> for the bounded selection above, or explicitly start full inventory. QMS will not start an unbounded scan from Continue.
                </div>
              )}
              {interruptedScan && !scanning && (
                <div className="stack-sm" data-testid="interrupted-scan">
                  <p className="small warn-text">
                    Interrupted scan found ({String((interruptedScan.action?.params as Record<string, unknown> | undefined)?.mode ?? scan?.mode ?? 'scan')}, checkpoint {interruptedScan.step ?? 'unknown'} {interruptedScan.cursor}/{interruptedScan.total}). Completed pages and referenced terms stay reusable.
                  </p>
                  <button type="button" onClick={() => void resumeInterruptedScan()} disabled={resumingScan || busy}>
                    {resumingScan ? 'Resuming…' : 'Resume interrupted scan from checkpoint'}
                  </button>
                </div>
              )}
              <div className="row wrap gap">
                {scanning ? (
                  <>
                    <button type="button" onClick={() => void pauseScan()} disabled={!scanRunId || busy}>Pause</button>
                    <button type="button" className="danger" onClick={() => void cancelScan()} disabled={!scanRunId || busy}>Cancel scan</button>
                    <span className="small muted">{scanRunId ? 'Run ' + scanRunId : 'Starting…'}</span>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => void runScan(scanMode)} disabled={busy || resumingScan || (scanMode === 'full' && !fullScanAcknowledged)}>
                      {scanMode === 'quick' ? 'Run quick scan' : 'Run full inventory'}
                    </button>
                    {scanConfirmRequired && scanMode === 'quick' && (
                      <button type="button" className="primary" onClick={() => void runScan('quick', { continueAfter: true })} disabled={busy || resumingScan}>
                        Confirm quick scan and continue
                      </button>
                    )}
                    {scanMode === 'full' && (
                      <button type="button" className="primary" onClick={() => void runScan('full', { continueAfter: true })} disabled={busy || resumingScan || !fullScanAcknowledged}>
                        Confirm full inventory and continue
                      </button>
                    )}
                  </>
                )}
              </div>
              {scanTelemetry && (
                <div className="small" data-testid="scan-telemetry">
                  Phase {scanTelemetry.phase} · mode {scanTelemetry.mode ?? scanMode} · {scanTelemetry.postsScanned ?? 0}/{scanTelemetry.requested ?? '?'} item(s) · API pages {scanTelemetry.pages ?? '—'} · media deps {scanTelemetry.mediaDependencies ?? 0} · terms {scanTelemetry.termsReferenced ?? 0} · {scanTelemetry.bytesTransferred !== null ? formatBytes(scanTelemetry.bytesTransferred) : 'bytes —'}
                </div>
              )}
              {scanError && !scanning && (
                <div data-testid="scan-error">
                  <Alert tone="bad" title="Source scan did not complete">
                    <span data-testid="scan-error-text">{scanError}</span>
                  </Alert>
                </div>
              )}
              {scanning && <p className="small">{scanProgress || 'Scanning the source…'}</p>}
              {!scanning && scanProgress && <p className="small muted">{scanProgress}</p>}
              {scan ? (
                <div className="stack-sm">
                  <p className="small">
                    Last completed {scan.mode ?? 'scan'} {scan.completedAt ? formatDate(scan.completedAt) : 'just now'}
                    {scan.batchId ? ' · batch ' + scan.batchId : ''}
                    {scanState ? ' · ' + scanState : ''}
                  </p>
                  <p className="small muted">
                    Scope: {scopeNumber(scan.scope, 'scanned') ?? ((scan.counts.posts ?? 0) + (scan.counts.pages ?? 0))} item(s) scanned, requested {scopeNumber(scan.scope, 'requested') ?? '—'}, source total {totalAvailableLabel(scan.scope)}, API pages {scopeNumber(scan.scope, 'pagesFetched') ?? scopeNumber(scan.metrics, 'pages') ?? '—'}, media dependencies {scopeNumber(scan.scope, 'mediaDependencies') ?? scan.counts.media ?? 0}, referenced terms {scopeNumber(scan.scope, 'termsReferenced') ?? ((scan.counts.categories ?? 0) + (scan.counts.tags ?? 0))}.
                  </p>
                  <div className="row wrap gap">
                    <span className="pill">Posts indexed: {scan.counts.posts ?? 0}</span>
                    <span className="pill">Pages indexed: {scan.counts.pages ?? 0}</span>
                    <span className="pill">Categories indexed: {scan.counts.categories ?? 0}</span>
                    <span className="pill">Tags indexed: {scan.counts.tags ?? 0}</span>
                  </div>
                  {underReturnMessage && (
                    <p className="small warn-text" data-testid="scan-under-returned">{underReturnMessage}</p>
                  )}
                  <div className="row wrap gap">
                    <span className="pill">Media dependencies: {scan.counts.media ?? 0}</span>
                  </div>
                  {scan.truncated && (
                    <p className="small warn-text">The scan stopped at an item limit; this batch is partial. Rescan before relying on an empty result.</p>
                  )}
                </div>
              ) : (
                <p className="small muted">No source scan has completed for this project. Planning needs an indexed content batch. Choose a bounded scope above and run it explicitly.</p>
              )}
            </div>
            <div className="wide capability-box">
              <strong>Workspace location</strong>
              <code>{settings.dataRoot}</code>
              <p className="small muted">Project data lives outside the installation directory and persists after an ordinary uninstall. Change the workspace on the dashboard before creating a project.</p>
              <button type="button" className="ghost" onClick={() => void api().app.openPath(settings.dataRoot)}>Open workspace folder</button>
            </div>
            <div className="wide row wrap gap">
              <button type="button" onClick={() => void checkDisk()} disabled={busy}>Check disk</button>
              {diskPreview && (
                <span className="pill">Free {formatBytes(diskPreview.availableBytes)} · reserve {formatBytes(diskPreview.reserveBytes)} · {diskPreview.fits ? 'fits' : 'does not fit'}</span>
              )}
            </div>
          </div>
        </Card>
      )}

      {step === 5 && (
        <div className="stack">
          <Card title="Plan review" subtitle="This is a qms-plan@1 preview. It prepares locally and never publishes, signs or spends QORT." actions={<button onClick={() => void loadPreview()} disabled={previewing}>{previewing ? 'Loading…' : 'Refresh preview'}</button>}>
            {previewing && (
              <div className="stack-sm" data-testid="planning-progress">
                <p className="muted">
                  {planPhase
                    ? planPhase.message + (planPhase.total > 0 ? ' (' + planPhase.completed + ' / ' + planPhase.total + ')' : ' (' + planPhase.completed + ' so far)')
                    : 'Scanning the source and building the plan preview…'}
                </p>
                <p className="small muted">Phase: {planPhase?.phase ?? 'starting'}. Counts are reported by the engine; no percentage is shown until a real total is known.</p>
              </div>
            )}
            {!planPreview && !previewing && <p className="muted">No plan preview has been loaded.</p>}
            {planFailure && (
              <Alert tone="bad" title={'Planning failed: ' + planFailure.code}>
                <p>{planFailure.message}</p>
                {planFailure.details && (
                  <details>
                    <summary>Technical details</summary>
                    <pre className="small">{formatScalar(planFailure.details)}</pre>
                  </details>
                )}
                <p className="small">Nothing was approved. Fix the cause and refresh the preview.</p>
              </Alert>
            )}
            {planPreview && (
              <div className="stack-sm" data-testid="plan-review">
                <div className="row wrap gap">
                  <Badge tone={planDocument?.status === 'blocked' ? 'bad' : 'info'}>{planDocument?.status ?? planPreview.status}</Badge>
                  <span className="pill">Selected: {planDocument?.stats.selected ?? planPreview.stats?.selected ?? 0}</span>
                  <span className="pill">Scanned: {planDocument?.stats.scanned ?? planPreview.stats?.scanned ?? 0}</span>
                  <span className="pill">New: {planDocument?.stats.new ?? 0}</span>
                  <span className="pill">Modified: {planDocument?.stats.modified ?? 0}</span>
                  <span className="pill">Route-only: {planDocument?.stats.route_changed ?? 0}</span>
                  <span className="pill">Unchanged (verified): {planDocument?.stats.unchanged ?? 0}</span>
                  <span className="pill">Reserved pending: {planDocument?.stats.reserved ?? 0}</span>
                  <span className="pill">Conflicts: {planDocument?.stats.conflict ?? 0}</span>
                </div>
                {underReturnMessage && (
                  <Alert tone="warn" title="Source returned a short page">
                    <p data-testid="plan-under-returned">{underReturnMessage}</p>
                  </Alert>
                )}
                {planDocument?.selection?.empty && (
                  <Alert tone="warn" title="No content matches the current filters">
                    <p>{describeDateRange(planDocument.filters?.after, planDocument.filters?.before)}</p>
                    {planDocument.selection.emptyExplanation && planDocument.selection.emptyExplanation.length > 0 ? (
                      <ul className="small">
                        {planDocument.selection.emptyExplanation.map((entry, index) => <li key={String(index)}>{entry}</li>)}
                      </ul>
                    ) : (
                      <p className="small">The plan selected 0 items. Adjust the date range or content types and refresh the preview.</p>
                    )}
                    {planDiagnostics && (
                      <p className="small muted">
                        Indexed: {planDiagnostics.indexed} · supported: {planDiagnostics.supported} · matched filters: {planDiagnostics.matched} · actionable: {planDiagnostics.actionable}
                        {planDiagnostics.unsupported > 0 ? ' · unsupported: ' + planDiagnostics.unsupported : ''}
                      </p>
                    )}
                    <p className="small">Approval is disabled while nothing is selected. This prevents an empty plan from being marked complete.</p>
                  </Alert>
                )}
                {planDocument && (
                  <>
                    <div className="grid-2">
                      <div className="capability-box">
                        <strong>Media</strong>
                        <p className="small">Resources: {planDocument.mediaSummary.count} · known {planDocument.mediaSummary.knownCount} · unknown {planDocument.mediaSummary.unknownCount} · missing {planDocument.mediaSummary.missingCount}</p>
                        <p className="small">Known bytes: {formatBytes(planDocument.mediaSummary.knownBytes)}</p>
                        {(planDocument.mediaSummary.unreferencedAttachmentsSkipped ?? 0) > 0 && (
                          <p className="small muted" data-testid="unreferenced-attachments">
                            {(planDocument.mediaSummary.unreferencedAttachmentsSkipped ?? 0)} media-library attachment(s) are not referenced by the selected posts and were not added as required dependencies. They remain in the source index and can be included in Advanced settings.
                          </p>
                        )}
                      </div>
                      <div className="capability-box">
                        <strong>Disk</strong>
                        <p className="small">Available: {formatBytes(planDocument.disk.availableBytes)}</p>
                        <p className="small">Reserve: {formatBytes(planDocument.disk.reserveBytes)} · projected: {formatBytes(planDocument.disk.projectedBytes)}</p>
                        <p className={planDocument.disk.fits ? 'small good-text' : 'small danger-text'}>{planDocument.disk.fits ? 'Fits the configured safety limits.' : 'Blocked: ' + formatScalar(planDocument.disk.message ?? planDocument.disk.reason ?? 'does not fit')}</p>
                      </div>
                      <div className="capability-box">
                        <strong>Estimated QDN fee</strong>
                        <p className="small">{planDocument.estimates.totalResources} resources × {planDocument.estimates.feePerResource} {planDocument.estimates.feeCurrency} ≈ {planDocument.estimates.estimatedFee} {planDocument.estimates.feeCurrency}</p>
                        <p className="small warn-text">Estimate only. Phase 5 must quote the current network fee before approval. No transaction is created here.</p>
                      </div>
                      <div className="capability-box">
                        <strong>Publication state</strong>
                        <p className="small">{planDocument.pendingPublication.count} item(s) reserved or prepared locally; {planDocument.pendingPublication.prepared} locally prepared.</p>
                        <p className="small warn-text">Reserved is not published. Publication requires Phase 5 remote read-back.</p>
                      </div>
                    </div>
                    {planDocument.entries.length > 0 && (
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>Item</th><th>Type</th><th>Status</th><th>Publication</th><th>Media</th><th>QDN identifier</th></tr></thead>
                          <tbody>
                            {planDocument.entries.filter((entry) => entry.qdn).slice(0, 100).map((entry) => (
                              <tr key={entry.id}>
                                <td>{entry.title ?? entry.sourceKey}</td>
                                <td>{entry.contentType}</td>
                                <td><Badge tone={entry.status === 'conflict' || entry.status === 'error' ? 'bad' : entry.status === 'reserved' ? 'warn' : 'neutral'}>{entry.status}</Badge></td>
                                <td>{entry.pendingPublication ? 'Reserved — not published' : entry.publicationStatus ?? '—'}</td>
                                <td>{entry.mediaCount}</td>
                                <td><code>{entry.qdn.identifier}</code></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {planDocument.warnings.length > 0 && (
                      <div>
                        <strong>Warnings</strong>
                        <ul className="small warn-text">{planDocument.warnings.map((warning, index) => <li key={String(index)}>{warning.code}: {warning.message}</li>)}</ul>
                      </div>
                    )}
                    {planDocument.errors.length > 0 && (
                      <div>
                        <strong>Errors</strong>
                        <ul className="small danger-text">{planDocument.errors.map((entry, index) => <li key={String(index)}>{entry.code}: {entry.message}</li>)}</ul>
                      </div>
                    )}
                    {planDocument.conflicts.length > 0 && (
                      <div>
                        <strong>Conflicts</strong>
                        <ul className="small danger-text">{planDocument.conflicts.map((conflict, index) => <li key={String(index)}>{formatScalar(conflict.kind ?? 'conflict')}: {formatScalar(conflict.message ?? '')}</li>)}</ul>
                      </div>
                    )}
                    <p className="small muted">Plan created {formatDate(planDocument.createdAt)}. Batch {planDocument.batchId}.</p>
                  </>
                )}
              </div>
            )}
          </Card>
          <div className="row wrap gap">
            <button className="primary" onClick={() => void approve()} disabled={busy || !canApprove}>Approve local preparation</button>
            <button onClick={() => void goTo(4)}>Back to settings</button>
            <span className="muted small">{canApprove ? 'Approval reserves identity mappings and writes a plan. It does not publish.' : approveBlockReason}</span>
          </div>
        </div>
      )}

      {step < 5 && (
        <div className="wizard-actions row between">
          <button className="ghost" onClick={() => void goTo(Math.max(1, step - 1))} disabled={step === 1 || busy}>Back</button>
          <button className="primary" onClick={() => void next()} disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
        </div>
      )}
      {step === 5 && <div className="wizard-actions row between"><button className="ghost" onClick={() => void goTo(4)}>Back</button><span /></div>}
    </div>
  );
}

