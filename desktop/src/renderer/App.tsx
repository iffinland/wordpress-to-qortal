import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import type { AdapterInfo, DesktopSettings, EngineInfo, ProjectDocument, ProjectSummary } from '../shared/types.js';
import { Dashboard } from './components/Dashboard.js';
import { Wizard } from './components/Wizard.js';
import { Progress } from './components/Progress.js';
import { History } from './components/History.js';
import { Publishing } from './components/Publishing.js';
import { SyncView } from './components/Sync.js';
import { ErrorText } from './components/Common.js';

type View = 'dashboard' | 'wizard' | 'progress' | 'history' | 'publishing' | 'sync';

function wizardPlanId(project: ProjectDocument): string | null {
  const settings = (project.settings ?? {}) as Record<string, unknown>;
  const wizard = settings.desktopWizard as Record<string, unknown> | undefined;
  const planId = wizard?.planId;
  return typeof planId === 'string' ? planId : null;
}

function wizardComplete(project: ProjectDocument): boolean {
  const settings = (project.settings ?? {}) as Record<string, unknown>;
  const wizard = settings.desktopWizard as Record<string, unknown> | undefined;
  const completed = Array.isArray(wizard?.completedSteps) ? wizard.completedSteps : [];
  return completed.includes(5);
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

  async function openProject(projectId: string) {
    setError(null);
    try {
      const opened = await api().projects.open(projectId);
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

  async function openHistory(projectId: string) {
    setError(null);
    try {
      const opened = await api().projects.open(projectId);
      setProject(opened.project);
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
    try {
      if (!project || project.id !== projectId) {
        const opened = await api().projects.open(projectId);
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
    try {
      if (!project || project.id !== projectId) {
        const opened = await api().projects.open(projectId);
        setProject(opened.project);
      }
      setView('sync');
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
          {info && <span className="pill">engine {info.version}</span>}
          {settings && <span className={'pill ' + (settings.keyring.available ? 'good-text' : 'warn-text')}>{settings.keyring.available ? 'keyring available' : 'session-only credentials'}</span>}
          {project && <button className="ghost" onClick={() => void openSync(project.id)}>Sync</button>}
          {project && <button className="ghost" onClick={() => void openPublishing(project.id)}>Publishing</button>}
          <button className="ghost" onClick={() => void backToDashboard()}>Dashboard</button>
        </div>
      </header>

      <main className="app-main">
        <ErrorText error={error} />
        {view === 'dashboard' && (
          <Dashboard
            projects={projects}
            adapters={adapters}
            onRefresh={refreshProjects}
            onOpen={openProject}
            onHistory={openHistory}
            onSync={openSync}
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

