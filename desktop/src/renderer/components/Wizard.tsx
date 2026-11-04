import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type { AdapterInfo, DesktopSettings, PlanCreateResult, PlanDocument, ProjectDocument, SourceValidationResult, WizardState } from '../../shared/types.js';
import { Alert, Badge, Card, ErrorText, Field } from './Common.js';
import { formatBytes, formatDate } from '../format.js';

const STEPS = [
  'Source CMS',
  'WordPress connection',
  'Qortal destination',
  'Import preferences',
  'Plan and review'
];

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
  const stored = storedWizard(project);
  const source = (project.source ?? {}) as Record<string, unknown>;
  const target = (project.target ?? {}) as Record<string, unknown>;
  return {
    step: stored.step ?? 1,
    completedSteps: Array.isArray(stored.completedSteps) ? stored.completedSteps : [],
    adapterId: stored.adapterId ?? String(source.adapter ?? adapters[0]?.id ?? 'wordpress'),
    sourceUrl: stored.sourceUrl ?? String(source.baseUrl ?? ''),
    authMode: stored.authMode ?? 'none',
    connection: stored.connection ?? null,
    targetQdnName: stored.targetQdnName ?? String(target.qdnName ?? ''),
    siteTitle: stored.siteTitle ?? String(target.siteName ?? project.name ?? ''),
    siteDescription: stored.siteDescription ?? String(target.siteDescription ?? ''),
    preferences: stored.preferences ?? {},
    planId: stored.planId ?? null,
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
  const preferences = (initial.preferences ?? {}) as Record<string, unknown>;
  const [step, setStep] = useState(Math.max(1, Math.min(5, initial.step)));
  const [completed, setCompleted] = useState<number[]>(initial.completedSteps);
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
  const [diskPreview, setDiskPreview] = useState<Record<string, unknown> | null>(null);
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
    if (step === 5 && !planPreview) void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function wizardState(nextStep = step, nextCompleted = completed): WizardState {
    return {
      step: nextStep,
      completedSteps: nextCompleted,
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
        unknownPolicy
      },
      planId: planPreview?.planId ?? initial.planId ?? null,
      updatedAt: new Date().toISOString()
    };
  }

  async function persist(nextStep = step, nextCompleted = completed) {
    await api().projects.saveWizard(project.id, wizardState(nextStep, nextCompleted));
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
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9_-]{1,38}[A-Za-z0-9])$/.test(targetName.trim())) return 'The Qortal name format is invalid.';
      if (!siteTitle.trim()) return 'A website title is required.';
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
      return '';
    }
    if (current === 5) {
      if (!planPreview) return 'Load the plan review first.';
      if (planPreview.status === 'blocked') return 'The plan is blocked. Adjust preferences before approval.';
      return '';
    }
    return '';
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
        const target = await api().identity.validateTarget({ qdnName: targetName.trim() });
        await api().projects.update(project.id, {
          target: { qdnName: target.qdnName, siteName: siteTitle.trim(), siteDescription: siteDescription.trim() }
        });
      }
      if (step === 4) {
        await savePreferences();
      }
      const nextStep = Math.min(5, step + 1);
      const nextCompleted = completed.includes(step) ? completed : [...completed, step];
      setCompleted(nextCompleted);
      setStep(nextStep);
      await persist(nextStep, nextCompleted);
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
      unknownSizePolicy: unknownPolicy
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
    setPreviewing(true);
    setError(null);
    try {
      const result = await api().plans.create(project.id, planOptions(false));
      setPlanPreview(result);
      setPlanDocument(result.plan ?? null);
    } catch (previewError) {
      setError(previewError);
    } finally {
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
      setPlanPreview(result);
      setPlanDocument(result.plan ?? null);
      if (result.status !== 'completed' || !result.planId || result.plan?.status !== 'ready') {
        setStepError('The plan did not become ready. Nothing was approved for preparation.');
        return;
      }
      const nextCompleted = completed.includes(5) ? completed : [...completed, 5];
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
          const clickable = number <= Math.max(1, ...completed.map((value) => value + 1));
          return (
            <li key={label} className={number === step ? 'active' : completed.includes(number) ? 'done' : ''}>
              <button disabled={!clickable} onClick={() => void goTo(number)}>
                <span className="step-number">{completed.includes(number) ? '✓' : number}</span>
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
              <div className="row wrap gap"><span>Unsupported: {Object.keys(adapter.capabilities.unsupported).join(', ') || 'none reported'}</span></div>
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
                {Object.entries(connection.report.counts ?? {}).map(([key, value]) => <span key={key} className="pill">{key}: {String(value)}</span>)}
              </div>
              {Object.keys(connection.report.unsupported ?? {}).length > 0 && (
                <div className="small muted">Unsupported features: {Object.entries(connection.report.unsupported ?? {}).map(([key, value]) => key + ' (' + String(value) + ')').join(', ')}</div>
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
            <Field label="Target Qortal name" hint="3–40 letters, digits, underscores or hyphens.">
              <input value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="MyQortalName" />
            </Field>
            <Field label="Website title">
              <input value={siteTitle} onChange={(event) => setSiteTitle(event.target.value)} />
            </Field>
            <Field label="Website description">
              <textarea value={siteDescription} onChange={(event) => setSiteDescription(event.target.value)} rows={3} />
            </Field>
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
            <Field label="Published after" hint="Optional ISO date.">
              <input type="date" value={after.slice(0, 10)} onChange={(event) => setAfter(event.target.value ? new Date(event.target.value + 'T00:00:00Z').toISOString() : '')} />
            </Field>
            <Field label="Published before">
              <input type="date" value={before.slice(0, 10)} onChange={(event) => setBefore(event.target.value ? new Date(event.target.value + 'T00:00:00Z').toISOString() : '')} />
            </Field>
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
            {!planPreview && <p className="muted">Loading plan preview…</p>}
            {planPreview && (
              <div className="stack-sm" data-testid="plan-review">
                <div className="row wrap gap">
                  <Badge tone={planDocument?.status === 'blocked' ? 'bad' : 'info'}>{planDocument?.status ?? planPreview.status}</Badge>
                  <span className="pill">Selected: {planDocument?.stats.selected ?? planPreview.stats?.selected ?? 0}</span>
                  <span className="pill">New: {planDocument?.stats.new ?? 0}</span>
                  <span className="pill">Modified: {planDocument?.stats.modified ?? 0}</span>
                  <span className="pill">Route-only: {planDocument?.stats.route_changed ?? 0}</span>
                  <span className="pill">Unchanged (verified): {planDocument?.stats.unchanged ?? 0}</span>
                  <span className="pill">Reserved pending: {planDocument?.stats.reserved ?? 0}</span>
                  <span className="pill">Conflicts: {planDocument?.stats.conflict ?? 0}</span>
                </div>
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
                        <p className={planDocument.disk.fits ? 'small good-text' : 'small danger-text'}>{planDocument.disk.fits ? 'Fits the configured safety limits.' : 'Blocked: ' + String(planDocument.disk.message ?? planDocument.disk.reason ?? 'does not fit')}</p>
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
                        <ul className="small danger-text">{planDocument.conflicts.map((conflict, index) => <li key={String(index)}>{String(conflict.kind ?? 'conflict')}: {String(conflict.message ?? '')}</li>)}</ul>
                      </div>
                    )}
                    <p className="small muted">Plan created {formatDate(planDocument.createdAt)}. Batch {planDocument.batchId}.</p>
                  </>
                )}
              </div>
            )}
          </Card>
          <div className="row wrap gap">
            <button className="primary" onClick={() => void approve()} disabled={busy || !planPreview || planPreview.status === 'blocked'}>Approve local preparation</button>
            <button onClick={() => void goTo(4)}>Back to settings</button>
            <span className="muted small">Approval reserves identity mappings and writes a plan. It does not publish.</span>
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

