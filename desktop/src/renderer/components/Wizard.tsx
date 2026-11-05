import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import type { AdapterInfo, DesktopSettings, FilterDiagnostics, PlanCreateResult, PlanDocument, ProjectDocument, QmsEvent, SourceValidationResult, WizardState } from '../../shared/types.js';
import { Alert, Badge, Card, ErrorText, Field } from './Common.js';
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
  type WizardStepId
} from '../../shared/wizard.js';

const STEPS = WIZARD_STEP_IDS.map((id) => WIZARD_STEP_LABELS[id]);

interface DiscoveryInfo {
  batchId: string | null;
  completedAt: string;
  counts: Record<string, number>;
  contentTypes: string[];
  truncated: boolean;
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
    truncated: record.truncated === true
  };
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
    wizardVersion: 2,
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
  const previewInFlight = useRef(false);
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

  useEffect(() => {
    if (step === 5 && !planPreview && !previewing && !previewInFlight.current) void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
      if (event.progress && (event.type === 'progress_updated' || event.type === 'operation_started')) {
        const total = Number(event.progress.total ?? 0);
        const completed = Number(event.progress.completed ?? 0);
        setScanProgress(event.message ?? ('Scanning: ' + completed + (total > 0 ? '/' + total : '') + ' item(s)'));
      }
    });
    return unsubscribe;
  }, [project.id]);

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
      wizardVersion: 2,
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
        concurrency: Number(concurrency),
        reserveGib: Number(reserveGib),
        maxRunGib: Number(maxRunGib),
        maxFileMib: Number(maxFileMib),
        maxFiles: Number(maxFiles),
        unknownPolicy,
        discovery: effectiveScan ?? undefined
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

  async function runScan(): Promise<DiscoveryInfo | null> {
    setScanning(true);
    setScanProgress('Connecting to the source…');
    setError(null);
    setStepError('');
    try {
      const result = await api().sources.discover(project.id, {
        adapterId,
        contentTypes,
        perPage: 100
      }) as Record<string, unknown>;
      if (result.status !== 'completed') {
        const failure = result.error && typeof result.error === 'object' ? result.error as Record<string, unknown> : {};
        const message = typeof failure.message === 'string' ? failure.message : 'The source scan did not complete.';
        const code = typeof failure.code === 'string' ? failure.code : 'SOURCE_SCAN_FAILED';
        setPlanFailure({ code, message, details: failure.details as Record<string, unknown> | undefined });
        setStepError('Source scan failed (' + code + '): ' + message);
        return null;
      }
      const report = result.report && typeof result.report === 'object' ? result.report as Record<string, unknown> : {};
      const summary = result.summary && typeof result.summary === 'object' ? result.summary as Record<string, unknown> : {};
      const info: DiscoveryInfo = {
        batchId: typeof result.batchId === 'string' ? result.batchId : null,
        completedAt: new Date().toISOString(),
        counts: numericCounts(report.counts ?? summary.counts),
        contentTypes,
        truncated: Boolean(summary.truncated ?? report.truncated)
      };
      setScan(info);
      setScanProgress('Scan complete.');
      await persist(step, completed, info);
      return info;
    } catch (scanError) {
      setError(scanError);
      setStepError('Source scan failed: ' + (scanError instanceof Error ? scanError.message : 'unknown error'));
      return null;
    } finally {
      setScanning(false);
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
          scanOverride = await runScan();
          if (!scanOverride) return;
        }
      }
      const nextStep = Math.min(5, step + 1);
      const currentId = WIZARD_STEP_IDS[step - 1];
      const nextCompleted: WizardStepId[] = completed.includes(currentId) ? completed : [...completed, currentId];
      setCompleted(nextCompleted);
      setStep(nextStep);
      await persist(nextStep, nextCompleted, scanOverride);
      if (nextStep === 5) await loadPreview();
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
      media: { allowExternalMedia: allowExternal, concurrency: Number(concurrency) || 4 },
      estimateMedia: true,
      persist: persistPlan
    };
  }

  async function loadPreview() {
    previewInFlight.current = true;
    setPreviewing(true);
    setError(null);
    setPlanFailure(null);
    try {
      if (!(await hasCompletedDiscovery())) {
        const info = await runScan();
        if (!info) return;
      }
      const result = await api().plans.create(project.id, planOptions(false));
      applyPlanResult(result);
    } catch (previewError) {
      setError(previewError);
      setPlanFailure({
        code: (previewError as { code?: string } | null)?.code ?? 'PLAN_PREVIEW_FAILED',
        message: previewError instanceof Error ? previewError.message : 'The plan preview could not be loaded.'
      });
    } finally {
      previewInFlight.current = false;
      setPreviewing(false);
    }
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
            <Field label="Authentication mode" hint="Modes are reported by the adapter.">
              <select value={authMode} onChange={(event) => { setAuthMode(event.target.value); setConnection(null); }}>
                {authModes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
              </select>
            </Field>
            {authMode !== 'none' && (
              <Field label="Username">
                <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
              </Field>
            )}
            {authMode === 'application_password' && (
              <Field label="Application password" hint="Used for this session; never stored in plaintext.">
                <input type="password" value={appPassword} onChange={(event) => setAppPassword(event.target.value)} autoComplete="current-password" />
              </Field>
            )}
            {authMode === 'session' && (
              <Field label="Password" hint="Session login through the WordPress login endpoint.">
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
            <Field label="Batch size" hint="Default 15. Integer from 1 to 1000.">
              <input type="number" min={1} max={1000} value={batchSize} onChange={(event) => setBatchSize(event.target.value)} />
            </Field>
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
            <div className="wide capability-box" data-testid="source-scan">
              <strong>Source scan</strong>
              {scan ? (
                <div className="stack-sm">
                  <p className="small">
                    Last completed scan {scan.completedAt ? formatDate(scan.completedAt) : 'just now'}
                    {scan.batchId ? ' · batch ' + scan.batchId : ''}
                  </p>
                  <div className="row wrap gap">
                    <span className="pill">Posts: {scan.counts.posts ?? 0}</span>
                    <span className="pill">Pages: {scan.counts.pages ?? 0}</span>
                    <span className="pill">Categories: {scan.counts.categories ?? 0}</span>
                    <span className="pill">Tags: {scan.counts.tags ?? 0}</span>
                    <span className="pill">Media: {scan.counts.media ?? 0}</span>
                  </div>
                  {scan.truncated && (
                    <p className="small warn-text">The scan stopped at an item limit; this batch is partial. Rescan before relying on an empty result.</p>
                  )}
                </div>
              ) : (
                <p className="small muted">No source scan has completed for this project. Planning needs an indexed content batch; QMS will scan automatically when you continue.</p>
              )}
              <button type="button" onClick={() => void runScan()} disabled={scanning || busy}>
                {scanning ? 'Scanning…' : scan ? 'Rescan WordPress content' : 'Scan WordPress content'}
              </button>
              {scanning && <p className="small">{scanProgress || 'Scanning the source…'}</p>}
              {!scanning && scanProgress && <p className="small muted">{scanProgress}</p>}
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
            {previewing && <p className="muted">Scanning the source and building the plan preview…</p>}
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

