import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type { AdapterInfo, ProjectInspection, ProjectSummary } from '../../shared/types.js';
import { Badge, Card, ErrorText, Field } from './Common.js';
import { formatDate, shortId } from '../format.js';

interface DashboardProps {
  projects: ProjectSummary[];
  adapters: AdapterInfo[];
  onRefresh: () => Promise<void>;
  onOpen: (projectId: string) => Promise<void>;
  onHistory: (projectId: string) => Promise<void>;
  onSync: (projectId: string) => Promise<void>;
  onRecovery: (projectId: string) => Promise<void>;
}

export function Dashboard({ projects, adapters, onRefresh, onOpen, onHistory, onSync, onRecovery }: DashboardProps) {
  const [inspections, setInspections] = useState<Record<string, ProjectInspection>>({});
  const [inspectErrors, setInspectErrors] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(projects.length === 0);
  const [name, setName] = useState('');
  const [adapterId, setAdapterId] = useState(adapters[0]?.id ?? 'wordpress');
  const [sourceUrl, setSourceUrl] = useState('');
  const [qdnName, setQdnName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next: Record<string, ProjectInspection> = {};
      const errors: Record<string, string> = {};
      for (const project of projects) {
        try {
          next[project.id] = await api().projects.inspect(project.id);
        } catch (inspectError) {
          errors[project.id] = (inspectError as Error).message;
        }
      }
      if (!cancelled) {
        setInspections(next);
        setInspectErrors(errors);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projects]);

  const selectedAdapter = useMemo(() => adapters.find((adapter) => adapter.id === adapterId) ?? null, [adapters, adapterId]);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api().projects.create({
        name: name.trim(),
        source: { adapter: adapterId, ...(sourceUrl.trim() ? { baseUrl: sourceUrl.trim() } : {}) },
        target: { ...(qdnName.trim() ? { qdnName: qdnName.trim() } : {}), siteName: name.trim() },
        settings: { planning: { batchSize: 15 } }
      });
      await onRefresh();
      await onOpen(created.id);
    } catch (createError) {
      setError(createError);
    } finally {
      setBusy(false);
    }
  }

  async function archive(project: ProjectSummary) {
    if (!window.confirm('Archive “' + project.name + '”? This uses the safe project archive API and does not delete data.')) return;
    setBusy(true);
    setError(null);
    try {
      await api().projects.archive(project.id, false);
      setNotice('Project archived. Archived does not mean published.');
      await onRefresh();
    } catch (archiveError) {
      setError(archiveError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="hero">
        <div>
          <p className="eyebrow">Local preparation only</p>
          <h1>Your migration projects</h1>
          <p className="muted">Plan batches, verify media and inspect reserved identities. Nothing is published or signed in this phase.</p>
        </div>
        <button className="primary" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? 'Close' : 'New project'}
        </button>
      </div>

      {notice && <div className="notice">{notice}</div>}
      <ErrorText error={error} />

      {showCreate && (
        <Card title="Create a project" subtitle="A random, immutable site identity is generated automatically. You never type a technical identifier." testId="create-project">
          <form className="grid-2" onSubmit={createProject}>
            <Field label="Project name">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="My publication" required maxLength={120} />
            </Field>
            <Field label="Source CMS" hint="Adapters come from the engine capability registry.">
              <select value={adapterId} onChange={(event) => setAdapterId(event.target.value)}>
                {adapters.map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.displayName}</option>)}
              </select>
            </Field>
            <Field label="Source website URL" hint="Optional now; validated in the setup wizard.">
              <input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.org" />
            </Field>
            <Field label="Qortal name" hint="Optional now. Ownership is verified in Phase 5, not here.">
              <input value={qdnName} onChange={(event) => setQdnName(event.target.value)} placeholder="MyQortalName" />
            </Field>
            {selectedAdapter && (
              <div className="wide capability-box">
                <strong>Adapter capabilities</strong>
                <div className="row wrap gap">
                  <span>Content: {selectedAdapter.capabilities.contentTypes.join(', ') || 'none'}</span>
                  <span>Auth: {selectedAdapter.capabilities.authentication.join(', ')}</span>
                  <span>Contract: {selectedAdapter.contract}</span>
                </div>
              </div>
            )}
            <div className="wide row gap">
              <button className="primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create and continue'}</button>
              <span className="muted">No terminal commands required.</span>
            </div>
          </form>
        </Card>
      )}

      <div className="project-grid">
        {projects.map((project) => {
          const inspection = inspections[project.id];
          const problem = inspectErrors[project.id];
          const identity = inspection?.identity;
          const active = inspection?.activeRuns ?? 0;
          const interrupted = inspection?.interruptedRuns ?? 0;
          const pending = identity?.pendingPublicationCount ?? 0;
          const conflicts = identity?.unresolvedConflicts ?? 0;
          const wizard = (project as ProjectSummary & { settings?: Record<string, unknown> }).settings;
          void wizard;
          return (
            <article className="project-card" key={project.id} data-testid={'project-' + project.id}>
              <header>
                <div>
                  <h2>{project.name}</h2>
                  <p className="muted">{project.sourceBaseUrl ?? 'Source not connected'}</p>
                </div>
                <div className="column align-end gap-sm">
                  {project.archivedAt ? <Badge tone="neutral">Archived</Badge> : <Badge tone="good">Active</Badge>}
                  {pending > 0 && <Badge tone="warn">{pending} reserved</Badge>}
                </div>
              </header>
              <dl className="meta-list">
                <div><dt>Destination</dt><dd>{project.targetQdnName ?? identity?.target?.qdnName as string ?? 'not set'}</dd></div>
                <div><dt>Site identity</dt><dd title={project.siteId ?? ''}>{shortId(project.siteId)}</dd></div>
                <div><dt>Last activity</dt><dd>{formatDate(inspection?.lastActivity ?? project.updatedAt)}</dd></div>
                <div><dt>Status</dt><dd>{problem ? 'Status unavailable: ' + problem : active > 0 ? 'Operation running' : interrupted > 0 ? 'Needs attention' : 'Ready'}</dd></div>
              </dl>
              {inspection && inspection.plans.length > 0 && (
                <p className="muted small">Last plan: {inspection.plans[0].status} · {inspection.plans[0].selectedCount} selected · {inspection.plans[0].pendingPublicationCount ?? 0} pending publication</p>
              )}
              {inspection?.sync?.latestScan && (
                <p className="muted small">
                  Last sync: {inspection.sync.latestScan.status} · new {inspection.sync.latestScan.counts?.new ?? 0} ·
                  modified {inspection.sync.latestScan.counts?.modified ?? 0} ·
                  withdrawn {inspection.sync.latestScan.counts?.withdrawn ?? 0}
                </p>
              )}
              {(inspection?.sync?.conflictCount ?? 0) > 0 && <p className="small danger-text">{inspection?.sync?.conflictCount} synchronization conflict(s) need resolution.</p>}
              {conflicts > 0 && <p className="small danger-text">{conflicts} identity conflict(s) need resolution.</p>}
              {pending > 0 && <p className="small warn-text">Reserved locally — not published. Continue preparation or publish in Phase 5.</p>}
              {project.archivedAt && <p className="small muted">Archived projects are not assumed published.</p>}
              <div className="row wrap gap">
                {project.archivedAt ? (
                  <span className="pill">Archived projects are read-only in this prototype</span>
                ) : (
                  <>
                    <button className="primary" onClick={() => void onOpen(project.id)}>Open</button>
                    <button onClick={() => void onSync(project.id)}>Check for updates</button>
                    <button onClick={() => void onHistory(project.id)}>History & diagnostics</button>
                    <button onClick={() => void onRecovery(project.id)}>Recovery & cleanup</button>
                    <button className="ghost" onClick={() => void archive(project)} disabled={busy}>Archive</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {projects.length === 0 && !showCreate && <p className="muted">No projects yet. Create one to begin.</p>}
    </div>
  );
}

