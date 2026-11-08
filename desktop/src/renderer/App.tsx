import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import type { AdapterInfo, DesktopSettings, EngineInfo, ProjectDocument, ProjectSummary } from '../shared/types.js';
import { Dashboard } from './components/Dashboard.js';
import { Wizard } from './components/Wizard.js';
import { Progress } from './components/Progress.js';
import { History } from './components/History.js';
import { Publishing } from './components/Publishing.js';
import { SyncView } from './components/Sync.js';
import { Recovery } from './components/Recovery.js';
import { ErrorText } from './components/Common.js';
import { normalizeCompletedSteps } from '../shared/wizard.js';
import { Updates } from './components/Updates.js';
import { TEXT_SIZES, storeTextSize, type TextSize } from './textSize.js';

type View = 'dashboard' | 'wizard' | 'progress' | 'history' | 'publishing' | 'sync' | 'recovery';

function wizardPlanId(project: ProjectDocument): string | null {
  const settings = (project.settings ?? {}) as Record<string, unknown>;
  const wizard = settings.desktopWizard as Record<string, unknown> | undefined;
  const planId = wizard?.planId;
  return typeof planId === 'string' ? planId : null;
}

function wizardComplete(project: ProjectDocument): boolean {
  const settings = (project.settings ?? {}) as Record<string, unknown>;
  const wizard = settings.desktopWizard as Record<string, unknown> | undefined;
  return normalizeCompletedSteps(wizard?.completedSteps).includes('plan');
}

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [publishingPlanId, setPublishingPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [staleLock, setStaleLock] = useState<{ projectId: string; message: string } | null>(null);
  const [textSize, setTextSize] = useState<TextSize>(() => {
    const current = Number(document.documentElement.dataset.textSize);
    return (TEXT_SIZES as readonly number[]).includes(current) ? current as TextSize : 100;
  });

  async function refreshProjects() {
    const list = await api().projects.list(true);
    setProjects(list);
  }

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const [appSettings, appInfo, projectList, adapterList] = await Promise.all([
          api().app.settings(),
          api().app.info(),
          api().projects.list(true),
          api().sources.list()
        ]);
        if (cancelled) return;
        setSettings(appSettings);
        setInfo(appInfo);
        setProjects(projectList);
        setAdapters(adapterList);
      } catch (bootError) {
        if (!cancelled) setError(bootError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => { cancelled = true; };
  }, []);

  async function openHandle(projectId: string) {
    try {
      return await api().projects.open(projectId);
    } catch (openError) {
      // A killed app leaves a lock whose owner process is verifiably gone. Do
      // not dead-end the user: offer explicit recovery instead of a raw error.
      const code = (openError as { code?: string } | null)?.code;
      if (code === 'PROJECT_LOCK_STALE') {
        setStaleLock({
          projectId,
          message: (openError as { message?: string })?.message ?? 'The previous session did not close cleanly.'
        });
        return null;
      }
      throw openError;
    }
  }

  async function openProject(projectId: string) {
    setError(null);
    setStaleLock(null);
    try {
      const opened = await openHandle(projectId);
      if (!opened) return;
      setProject(opened.project);
      const plan = wizardPlanId(opened.project);
      setPlanId(plan);
      setView(wizardComplete(opened.project) ? 'progress' : 'wizard');
      await refreshProjects();
      if (!settings) setSettings(await api().app.settings());
    } catch (openError) {
      setError(openError);
    }
  }

  async function recoverStaleProject() {
    if (!staleLock) return;
    setError(null);
    try {
      const opened = await api().projects.open(staleLock.projectId, true);
      setProject(opened.project);
      setPlanId(wizardPlanId(opened.project));
      setView('recovery');
      setStaleLock(null);
      await refreshProjects();
    } catch (openError) {
      setError(openError);
    }
  }

  async function openHistory(projectId: string) {
    setError(null);
    setStaleLock(null);
    try {
      if (!project || project.id !== projectId) {
        const opened = await openHandle(projectId);
        if (!opened) return;
        setProject(opened.project);
      }
      setView('history');
    } catch (openError) {
      setError(openError);
    }
  }

  async function openProgress(projectId: string, selectedPlanId: string) {
    setPlanId(selectedPlanId);
    setView('progress');
    if (!project || project.id !== projectId) {
      const opened = await api().projects.open(projectId);
      setProject(opened.project);
    }
  }

  async function openPublishing(projectId: string, initialPlanId: string | null = null) {
    setError(null);
    setStaleLock(null);
    try {
      if (!project || project.id !== projectId) {
        const opened = await openHandle(projectId);
        if (!opened) return;
        setProject(opened.project);
      }
      setPublishingPlanId(initialPlanId);
      setView('publishing');
    } catch (openError) {
      setError(openError);
    }
  }

  async function openSync(projectId: string) {
    setError(null);
    setStaleLock(null);
    try {
      if (!project || project.id !== projectId) {
        const opened = await openHandle(projectId);
        if (!opened) return;
        setProject(opened.project);
      }
      setView('sync');
    } catch (openError) {
      setError(openError);
    }
  }

  async function openRecovery(projectId: string) {
    setError(null);
    setStaleLock(null);
    try {
      if (!project || project.id !== projectId) {
        const opened = await openHandle(projectId);
        if (!opened) return;
        setProject(opened.project);
      }
      setView('recovery');
    } catch (openError) {
      setError(openError);
    }
  }

  async function backToDashboard() {
    setView('dashboard');
    setProject(null);
    setPlanId(null);
    setPublishingPlanId(null);
    await refreshProjects();
  }

  async function completeWizard(projectId: string, selectedPlanId: string) {
    setPlanId(selectedPlanId);
    setView('progress');
    await refreshProjects();
  }

  if (loading) {
    return <div className="splash" data-testid="app-shell"><div className="spinner" /><p>Starting Qortal Migration Studio…</p></div>;
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">Q</div>
          <div>
            <strong>Qortal Migration Studio</strong>
            <span className="muted small">Local WordPress → QDN preparation</span>
          </div>
        </div>
        <div className="row wrap gap">
          <label className="text-size-control" title="Global interface text size">
            <span className="small muted">Text size</span>
            <select
              aria-label="Interface text size"
              value={textSize}
              onChange={(event) => setTextSize(storeTextSize(Number(event.target.value) as TextSize))}
            >
              {TEXT_SIZES.map((size) => <option key={size} value={size}>{size}%</option>)}
            </select>
          </label>
          <Updates />
          {settings && <span className="pill">installed v{settings.appVersion}</span>}
          {info && <span className="pill">engine {info.version}</span>}
          {settings && <span className={'pill ' + (settings.keyring.available ? 'good-text' : 'warn-text')}>{settings.keyring.available ? 'keyring available' : 'session-only credentials'}</span>}
          {project && <button className="ghost" onClick={() => void openSync(project.id)}>Sync</button>}
          {project && <button className="ghost" onClick={() => void openRecovery(project.id)}>Recovery</button>}
          {project && <button className="ghost" onClick={() => void openPublishing(project.id)}>Publishing</button>}
          <button className="ghost" onClick={() => void backToDashboard()}>Dashboard</button>
        </div>
      </header>

      <main className="app-main">
        <ErrorText error={error} />
        {staleLock && (
          <section className="card warn" role="alert" data-testid="stale-lock-banner">
            <h2>Project needs recovery</h2>
            <p>{staleLock.message}</p>
            <p className="muted small">
              The previous session ended without closing the project lock. Recovery keeps your
              project, media, handoffs and history; it does not publish anything.
            </p>
            <button className="primary" onClick={() => void recoverStaleProject()}>
              Recover project
            </button>
          </section>
        )}
        {view === 'dashboard' && (
          <Dashboard
            projects={projects}
            adapters={adapters}
            onRefresh={refreshProjects}
            onOpen={openProject}
            onHistory={openHistory}
            onSync={openSync}
            onRecovery={openRecovery}
          />
        )}
        {view === 'wizard' && project && settings && (
          <Wizard
            project={project}
            adapters={adapters}
            settings={settings}
            onClose={backToDashboard}
            onComplete={completeWizard}
          />
        )}
        {view === 'progress' && project && (
          <Progress
            projectId={project.id}
            planId={planId}
            onBack={backToDashboard}
            onHistory={openHistory}
            onPublishing={openPublishing}
          />
        )}
        {view === 'publishing' && project && (
          <Publishing projectId={project.id} initialPlanId={publishingPlanId} onBack={backToDashboard} />
        )}
        {view === 'sync' && project && (
          <SyncView
            projectId={project.id}
            onBack={backToDashboard}
            onPublishing={(selectedPlanId) => void openPublishing(project.id, selectedPlanId)}
          />
        )}
        {view === 'recovery' && project && (
          <Recovery projectId={project.id} onBack={backToDashboard} />
        )}
        {view === 'history' && project && (
          <History
            projectId={project.id}
            onBack={backToDashboard}
            onProgress={openProgress}
          />
        )}
        {((view === 'wizard' && (!project || !settings)) || (view !== 'dashboard' && view !== 'wizard' && !project)) && (
          <div className="empty-state">
            <h2>Project not available</h2>
            <p className="muted">Return to the dashboard and open the project again.</p>
            <button className="primary" onClick={() => void backToDashboard()}>Dashboard</button>
          </div>
        )}
      </main>
      {settings && <footer className="app-footer"><span>Workspace: {settings.dataRoot}</span><span>Hub signs and approves; this app never holds wallet keys.</span></footer>}
    </div>
  );
}

