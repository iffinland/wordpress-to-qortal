import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type { DiagnosticsExport, IdentityMapping, MediaInspection, PlanRecord, ProjectDocument, RunSummary } from '../../shared/types.js';
import { Alert, Badge, Card, ErrorText } from './Common.js';
import { formatBytes, formatDate, publicationLabel, publicationTone } from '../format.js';

interface HistoryProps {
  projectId: string;
  onBack: () => Promise<void>;
  onProgress: (projectId: string, planId: string) => Promise<void>;
}

export function History({ projectId, onBack, onProgress }: HistoryProps) {
  const [project, setProject] = useState<ProjectDocument | null>(null);
  const [mappings, setMappings] = useState<IdentityMapping[]>([]);
  const [conflicts, setConflicts] = useState<Array<Record<string, unknown>>>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [media, setMedia] = useState<MediaInspection | null>(null);
  const [disk, setDisk] = useState<Record<string, unknown> | null>(null);
  const [exportResult, setExportResult] = useState<DiagnosticsExport | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  async function refresh() {
    try {
      const [projectResult, identity, planList, runList, inspection, diskReport] = await Promise.all([
        api().projects.open(projectId),
        api().identity.get(projectId),
        api().plans.list(projectId, 100),
        api().runs.list(projectId),
        api().media.inspect(projectId),
        api().disk.check(projectId, {})
      ]);
      setProject(projectResult.project);
      setMappings(identity.mappings);
      setConflicts(identity.conflicts);
      setPlans(planList);
      setRuns(runList);
      setMedia(inspection);
      setDisk(diskReport);
    } catch (refreshError) {
      setError(refreshError);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const counts = useMemo(() => {
    const output = { all: mappings.length, reserved: 0, prepared: 0, verified: 0, published: 0 };
    for (const mapping of mappings) {
      const publication = mapping.publicationStatus ?? (mapping.status === 'published' ? 'published' : 'reserved');
      if (publication === 'published') output.published += 1;
      else if (publication === 'remote_verified') output.verified += 1;
      else if (mapping.localPreparation === 'prepared') output.prepared += 1;
      else output.reserved += 1;
    }
    return output;
  }, [mappings]);

  const visibleMappings = useMemo(() => mappings.filter((mapping) => {
    if (statusFilter === 'all') return true;
    const publication = mapping.publicationStatus ?? (mapping.status === 'published' ? 'published' : 'reserved');
    if (statusFilter === 'published') return publication === 'published';
    if (statusFilter === 'verified') return publication === 'remote_verified';
    if (statusFilter === 'prepared') return publication !== 'published' && publication !== 'remote_verified' && mapping.localPreparation === 'prepared';
    return publication === 'reserved' && mapping.localPreparation !== 'prepared';
  }), [mappings, statusFilter]);

  async function resolve(conflictId: string, resolution: string) {
    setBusy(true);
    setError(null);
    try {
      await api().identity.resolveConflict(projectId, conflictId, resolution);
      setNotice('Conflict ' + conflictId + ' resolved with: ' + resolution + '.');
      await refresh();
    } catch (resolveError) {
      setError(resolveError);
    } finally {
      setBusy(false);
    }
  }

  async function exportDiagnostics() {
    setBusy(true);
    setError(null);
    try {
      const exported = await api().diagnostics.export(projectId);
      setExportResult(exported);
      setNotice('Diagnostics exported. Secrets and content bodies are excluded.');
    } catch (exportError) {
      setError(exportError);
    } finally {
      setBusy(false);
    }
  }

  async function openExportFolder() {
    if (!exportResult) return;
    const directory = exportResult.path.replace(/\/[^/]+$/, '');
    await api().app.openPath(directory);
  }

  return (
    <div className="stack">
      <div className="row between wrap gap">
        <div>
          <p className="eyebrow">History and diagnostics</p>
          <h1>{project?.name ?? 'Project'}</h1>
          <p className="muted">Operational evidence only. No secrets, auth headers, cookies, wallet material or content bodies are exported.</p>
        </div>
        <div className="row gap">
          <button className="ghost" onClick={() => void onBack()}>Dashboard</button>
          <button onClick={() => void refresh()}>Refresh</button>
        </div>
      </div>

      <ErrorText error={error} />
      {notice && <div className="notice">{notice}</div>}

      <div className="stat-grid">
        <div className="stat"><span className="stat-label">Reserved</span><strong>{counts.reserved}</strong></div>
        <div className="stat"><span className="stat-label">Prepared locally</span><strong>{counts.prepared}</strong></div>
        <div className="stat"><span className="stat-label">Remotely verified</span><strong>{counts.verified}</strong></div>
        <div className="stat"><span className="stat-label">Published</span><strong>{counts.published}</strong></div>
        <div className="stat"><span className="stat-label">Unresolved conflicts</span><strong>{conflicts.length}</strong></div>
        <div className="stat"><span className="stat-label">Storage used</span><strong>{formatBytes(media?.totals.bytes)}</strong></div>
      </div>

      <Alert tone="warn" title="Lifecycle correction">
        A reserved mapping means the identity was planned or prepared locally. It is never counted as published. Repeated planning reports reserved items separately instead of calling them unchanged.
      </Alert>

      <Card title="Identity mappings" subtitle="Publication status is independent from local preparation." actions={
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Mapping status filter">
          <option value="all">All ({counts.all})</option>
          <option value="reserved">Reserved ({counts.reserved})</option>
          <option value="prepared">Prepared locally ({counts.prepared})</option>
          <option value="verified">Remotely verified ({counts.verified})</option>
          <option value="published">Published ({counts.published})</option>
        </select>
      }>
        {mappings.length === 0 && <p className="muted">No identity mappings yet.</p>}
        {mappings.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Source item</th><th>Type</th><th>QDN identifier</th><th>Publication</th><th>Plan</th><th>Updated</th></tr></thead>
              <tbody>
                {visibleMappings.slice(0, 500).map((mapping) => {
                  const label = publicationLabel(mapping);
                  return (
                    <tr key={mapping.sourceKey}>
                      <td>{mapping.sourceKey}</td>
                      <td>{mapping.contentType}</td>
                      <td><code>{mapping.identifier}</code></td>
                      <td><Badge tone={publicationTone(label)}>{label}</Badge></td>
                      <td>{mapping.planId ?? '—'}</td>
                      <td>{formatDate(mapping.preparedAt ?? mapping.publishedAt ?? mapping.remoteVerifiedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {conflicts.length > 0 && (
        <Card title="Identity conflicts" subtitle="Explicit resolution is required; nothing is silently reassigned.">
          <div className="stack-sm">
            {conflicts.map((conflict) => {
              const id = String(conflict.id ?? '');
              const details = (conflict.details ?? {}) as Record<string, unknown>;
              return (
                <div className="conflict" key={id}>
                  <div>
                    <strong>{String(conflict.kind ?? 'conflict')}</strong>
                    <p className="small">{String(details.message ?? 'Review this conflict before planning.')}</p>
                    <p className="small muted">Source: {String(conflict.sourceKey ?? 'unknown')}</p>
                  </div>
                  <div className="row gap">
                    <button onClick={() => void resolve(id, 'skip')} disabled={busy}>Skip</button>
                    <button onClick={() => void resolve(id, 'alternate')} disabled={busy}>Use alternate identifier</button>
                    <button className="ghost" onClick={() => void resolve(id, 'abort')} disabled={busy}>Mark abort</button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Preparation history" subtitle="Plans and persisted media progress.">
        {plans.length === 0 && <p className="muted">No plans recorded.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Plan</th><th>Status</th><th>Selected</th><th>Pending publication</th><th>Download</th><th>Created</th><th></th></tr></thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.planId}>
                  <td><code>{plan.planId}</code></td>
                  <td><Badge tone={plan.status === 'ready' ? 'info' : 'bad'}>{plan.status}</Badge></td>
                  <td>{plan.selectedCount}</td>
                  <td>{plan.pendingPublicationCount ?? 0}</td>
                  <td>{plan.download ? String(plan.download.status ?? 'recorded') : 'not started'}</td>
                  <td>{formatDate(plan.createdAt)}</td>
                  <td><button className="ghost" onClick={() => void onProgress(projectId, plan.planId)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Recent operations" subtitle="Persisted run index.">
          {runs.length === 0 && <p className="muted">No runs recorded.</p>}
          <ul className="compact-list">
            {runs.slice(0, 20).map((run) => (
              <li key={run.id}>
                <Badge tone={run.state === 'completed' ? 'good' : run.state === 'failed' ? 'bad' : run.state === 'cancelled' ? 'warn' : 'info'}>{run.state}</Badge>
                <span>{run.kind}</span>
                <span className="muted small">{formatDate(run.startedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Storage and downloads" subtitle="Content-addressed media only; no Qortal Core storage is touched.">
          <dl className="meta-list">
            <div><dt>Assets</dt><dd>{media?.totals.assets ?? 0}</dd></div>
            <div><dt>Referenced assets</dt><dd>{media?.totals.referencedAssets ?? 0}</dd></div>
            <div><dt>Download receipts</dt><dd>{Object.entries(media?.downloads ?? {}).map(([status, count]) => status + ': ' + count).join(', ') || 'none'}</dd></div>
            <div><dt>Partial files</dt><dd>{media?.parts.count ?? 0} ({formatBytes(media?.parts.bytes)})</dd></div>
            <div><dt>Free disk</dt><dd>{formatBytes(disk?.availableBytes)}</dd></div>
            <div><dt>Reserve</dt><dd>{formatBytes(disk?.reserveBytes)}</dd></div>
          </dl>
        </Card>
      </div>

      <Card title="Safe diagnostic export" subtitle="Metadata-only JSON with a restrictive file mode.">
        <div className="row wrap gap">
          <button className="primary" onClick={() => void exportDiagnostics()} disabled={busy}>Export diagnostics</button>
          {exportResult && <button onClick={() => void openExportFolder()}>Open export folder</button>}
          {exportResult && <span className="pill">{exportResult.bytes} bytes · {formatDate(exportResult.createdAt)}</span>}
        </div>
        {exportResult && <p className="small muted wrap-anywhere">{exportResult.path}</p>}
        <p className="small muted">Credentials, authorization headers, cookies, wallet material and content bodies are excluded by key redaction before writing.</p>
      </Card>
    </div>
  );
}

