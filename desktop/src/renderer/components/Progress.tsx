import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import type { MediaDownloadResult, MediaInspection, PlanDocument, QmsEvent, RunSummary } from '../../shared/types.js';
import { Alert, Badge, Card, ErrorText, ProgressBar } from './Common.js';
import { formatBytes, formatDate } from '../format.js';

interface ProgressProps {
  projectId: string;
  planId: string | null;
  onBack: () => Promise<void>;
  onHistory: (projectId: string) => Promise<void>;
  onPublishing?: (projectId: string) => Promise<void>;
}

export function Progress({ projectId, planId, onBack, onHistory, onPublishing }: ProgressProps) {
  const [plan, setPlan] = useState<PlanDocument | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [events, setEvents] = useState<QmsEvent[]>([]);
  const [inspection, setInspection] = useState<MediaInspection | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [result, setResult] = useState<MediaDownloadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);

  const planRecord = plan ? null : null;
  void planRecord;

  async function refresh() {
    try {
      const planList = await api().plans.list(projectId, 50);
      const chosen = planId ?? planList[0]?.planId ?? null;
      if (chosen) {
        const loaded = await api().plans.get(projectId, chosen);
        if (mounted.current) setPlan(loaded.plan);
      }
      const [runList, mediaInspection] = await Promise.all([
        api().runs.list(projectId),
        api().media.inspect(projectId)
      ]);
      if (mounted.current) {
        setRuns(runList);
        setInspection(mediaInspection);
      }
    } catch (refreshError) {
      if (mounted.current) setError(refreshError);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = api().events.on((payload) => {
      const event = payload as QmsEvent;
      if (event.project_id !== projectId) return;
      if (!mounted.current) return;
      setEvents((current) => [...current.slice(-200), event]);
      if (event.run_id && (event.type === 'operation_started' || event.type === 'progress_updated')) {
        setCurrentRunId(event.run_id);
      }
      if (event.type === 'operation_completed' || event.type === 'operation_failed' || event.type === 'operation_cancelled') {
        setCurrentRunId(event.run_id ?? null);
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [projectId]);

  const latestRun = useMemo(() => {
    if (currentRunId) return runs.find((run) => run.id === currentRunId) ?? null;
    return runs[0] ?? null;
  }, [runs, currentRunId]);

  const lastProgress = useMemo(() => {
    const progressEvents = events.filter((event) => event.progress);
    return progressEvents.length > 0 ? progressEvents[progressEvents.length - 1] : null;
  }, [events]);

  const activeRun = runs.find((run) => run.state === 'running') ?? null;
  const downloadState = plan?.status === 'blocked' ? 'blocked' : result?.status ?? (activeRun?.kind === 'media.download' ? 'running' : plan?.status ?? 'ready');
  const reservedCount = plan?.pendingPublication?.count ?? 0;
  const preparedCount = plan?.pendingPublication?.prepared ?? 0;

  async function startDownload() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const download = await api().media.download(projectId, plan.planId, { concurrency: 4 });
      setResult(download);
      setCurrentRunId(download.runId ?? null);
      setNotice('Media run finished with status: ' + download.status + '. Verified files are reused on retry.');
      await refresh();
    } catch (downloadError) {
      setError(downloadError);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const runId = currentRunId ?? activeRun?.id;
    if (!runId) return;
    setBusy(true);
    setError(null);
    try {
      await api().runs.cancel(projectId, runId);
      setNotice('Cancellation requested. Verified files and .part checkpoints are kept.');
    } catch (cancelError) {
      setError(cancelError);
    } finally {
      setBusy(false);
    }
  }

  async function openDiagnostics() {
    await onHistory(projectId);
  }

  return (
    <div className="stack">
      <div className="row between wrap gap">
        <div>
          <p className="eyebrow">Local preparation</p>
          <h1>Preparation and progress</h1>
          <p className="muted">Checkpoint/resume only. The engine does not expose pause; retries reuse verified assets and partial downloads.</p>
        </div>
        <div className="row gap">
          <button onClick={() => void openDiagnostics()}>History & diagnostics</button>
          <button className="primary" onClick={() => void onPublishing?.(projectId)} disabled={!onPublishing}>Publish through Hub</button>
          <button className="ghost" onClick={() => void onBack()}>Dashboard</button>
        </div>
      </div>

      <ErrorText error={error} />
      {notice && <div className="notice">{notice}</div>}

      <div className="stat-grid">
        <div className="stat"><span className="stat-label">Plan</span><strong>{plan?.status ?? 'none'}</strong></div>
        <div className="stat"><span className="stat-label">Download</span><strong>{downloadState}</strong></div>
        <div className="stat"><span className="stat-label">Verified assets</span><strong>{inspection?.totals.assets ?? 0}</strong></div>
        <div className="stat"><span className="stat-label">Stored bytes</span><strong>{formatBytes(inspection?.totals.bytes)}</strong></div>
        <div className="stat"><span className="stat-label">Pending publication</span><strong>{reservedCount}</strong></div>
        <div className="stat"><span className="stat-label">Prepared locally</span><strong>{preparedCount}</strong></div>
      </div>

      {plan ? (
        <Card title="Current plan" subtitle={'Plan ' + plan.planId + ' · batch ' + plan.batchId} actions={<Badge tone={plan.status === 'ready' ? 'info' : 'bad'}>{plan.status}</Badge>}>
          <div className="stack-sm">
            <div className="row wrap gap">
              <span className="pill">{String(plan.selection.selected ?? 0)} selected</span>
              <span className="pill">{plan.mediaSummary.count} media resources</span>
              <span className="pill">Known {formatBytes(plan.mediaSummary.knownBytes)}</span>
              <span className="pill">{plan.mediaSummary.unknownCount} unknown size</span>
              <span className="pill">{plan.conflicts.length} conflicts</span>
            </div>
            <Alert tone="warn" title="Reserved is not published">
              {reservedCount} identity mapping(s) are reserved or locally prepared. Nothing in this screen proves QDN publication. Remote verification is Phase 5.
            </Alert>
            {plan.download && (
              <div className="capability-box">
                <strong>Persisted media progress</strong>
                <p className="small">Status: {String(plan.download.status ?? 'unknown')} · bytes {formatBytes(plan.download.downloadedBytes)} · files {String(plan.download.files ?? 0)} · reused {String(plan.download.reused ?? 0)}</p>
                <p className="small muted">Reconstructed from project state after reopening. Errors and partials are preserved.</p>
              </div>
            )}
            {(lastProgress?.progress || activeRun?.progress) && (
              <ProgressBar
                completed={lastProgress?.progress?.completed ?? activeRun?.progress?.completed ?? 0}
                total={lastProgress?.progress?.total ?? activeRun?.progress?.total ?? 0}
                bytes={lastProgress?.progress?.bytes ?? activeRun?.progress?.bytes ?? 0}
              />
            )}
            <div className="row wrap gap">
              <button className="primary" onClick={() => void startDownload()} disabled={busy || plan.status !== 'ready'}>
                {busy ? 'Working…' : plan.download ? 'Resume / repair media' : 'Start media preparation'}
              </button>
              <button onClick={() => void cancel()} disabled={busy || !(currentRunId ?? activeRun?.id)}>Cancel</button>
              <span className="small muted">Pause is not advertised because the engine does not support it.</span>
            </div>
            <div className="timeline">
              {events.filter((event) => event.phase || event.progress).slice(-40).map((event) => (
                <div className={'timeline-row level-' + event.level} key={event.id}>
                  <span className="timeline-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
                  <span className="timeline-phase">{event.phase ?? 'state'}</span>
                  <span className="timeline-code">{event.code}</span>
                  <span>{event.message}</span>
                </div>
              ))}
            </div>
            {result && (
              <div className="capability-box">
                <strong>Last media run</strong>
                <p className="small">Status: {result.status} · verified {result.counts?.verified ?? 0} · reused {result.counts?.reused ?? 0} · failed {result.counts?.failed ?? 0} · paused {result.counts?.paused ?? 0} · skipped {result.counts?.skipped ?? 0}</p>
                {(result.errors ?? []).length > 0 && <ul className="small danger-text">{(result.errors ?? []).map((entry, index) => <li key={String(index)}>{entry.code}: {entry.message}</li>)}</ul>}
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card title="No plan selected" subtitle="Approve a plan in the setup wizard first." />
      )}

      <Card title="Recent operations" subtitle="Reconstructed from the persisted run index.">
        {runs.length === 0 && <p className="muted">No operations yet.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Kind</th><th>State</th><th>Phase</th><th>Started</th><th>Progress</th></tr></thead>
            <tbody>
              {runs.slice(0, 20).map((run) => (
                <tr key={run.id}>
                  <td>{run.kind}</td>
                  <td><Badge tone={run.state === 'completed' ? 'good' : run.state === 'failed' ? 'bad' : run.state === 'cancelled' ? 'warn' : 'info'}>{run.state}</Badge></td>
                  <td>{run.phase}</td>
                  <td>{formatDate(run.startedAt)}</td>
                  <td>{run.progress ? run.progress.completed + ' / ' + run.progress.total : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

