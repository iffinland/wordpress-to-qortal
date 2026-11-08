import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type {
  CleanupPreview,
  CleanupRecord,
  HistoryEntry,
  RecoveryCandidate,
  RecoveryStatus,
  SupportBundleExport
} from '../../shared/types.js';
import { Alert, Badge, Card, ErrorText } from './Common.js';
import { formatBytes, formatDate } from '../format.js';

interface RecoveryProps {
  projectId: string;
  onBack: () => Promise<void>;
}

function toneForStatus(status: string): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (['remote_verified', 'verified', 'completed', 'quarantined', 'restored', 'purged', 'resumed'].includes(status)) return 'good';
  if (['pending_confirmation', 'submitted', 'handoff_ready', 'quarantining', 'paused'].includes(status)) return 'info';
  if (['ambiguous', 'partial', 'interrupted', 'blocked'].includes(status)) return 'warn';
  if (['failed', 'cancelled', 'abandoned'].includes(status)) return 'bad';
  return 'neutral';
}

function short(value: string | null | undefined, length = 22): string {
  if (!value) return '—';
  return value.length > length ? value.slice(0, length) + '…' : value;
}

export function Recovery({ projectId, onBack }: RecoveryProps) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [cleanups, setCleanups] = useState<CleanupRecord[]>([]);
  const [timeline, setTimeline] = useState<HistoryEntry[]>([]);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [retentionDays, setRetentionDays] = useState('14');
  const [forcePurge, setForcePurge] = useState(false);
  const [nodeUrl, setNodeUrl] = useState('');
  const [historyFilter, setHistoryFilter] = useState('all');
  const [bundle, setBundle] = useState<SupportBundleExport | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function refresh() {
    try {
      const [recoveryStatus, cleanupList, history] = await Promise.all([
        api().recovery.status(projectId),
        api().cleanup.list(projectId),
        api().history.list(projectId, 300)
      ]);
      setStatus(recoveryStatus);
      setCleanups(cleanupList);
      setTimeline(history);
    } catch (refreshError) {
      setError(refreshError);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const candidates: RecoveryCandidate[] = status?.candidates ?? [];
  const ambiguous = status?.ambiguousResources ?? [];

  const visibleHistory = useMemo(() => {
    if (historyFilter === 'all') return timeline;
    return timeline.filter((entry) => entry.type === historyFilter);
  }, [timeline, historyFilter]);

  const historyTypes = useMemo(() => {
    const types = new Set(timeline.map((entry) => entry.type));
    return [...types].sort();
  }, [timeline]);

  async function resume(candidate: RecoveryCandidate) {
    setBusy(true);
    setError(null);
    try {
      const result = await api().recovery.resume(projectId, candidate.stageId
        ? { stageId: candidate.stageId }
        : { runId: candidate.runId ?? undefined });
      setNotice('Recovery resumed from ' + String(result.resumedFrom?.step ?? 'the last checkpoint') + '. A fresh run continued the operation.');
      await refresh();
    } catch (resumeError) {
      setError(resumeError);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(candidate: RecoveryCandidate) {
    if (!candidate.runId) return;
    setBusy(true);
    setError(null);
    try {
      await api().recovery.dismiss(projectId, candidate.runId, 'Dismissed from the Recovery view.');
      setNotice('Operation dismissed. No publication was retried.');
      await refresh();
    } catch (dismissError) {
      setError(dismissError);
    } finally {
      setBusy(false);
    }
  }

  async function reconcile(handoffId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api().recovery.reconcile(projectId, { handoffId, nodeUrl: nodeUrl.trim() });
      setNotice('Reconciliation checked ' + String(result.reconciled ?? 0) + ' resource(s) with exact read-back. Resubmitted: no.');
      await refresh();
    } catch (reconcileError) {
      setError(reconcileError);
    } finally {
      setBusy(false);
    }
  }

  async function previewCleanup() {
    setBusy(true);
    setError(null);
    try {
      const result = await api().cleanup.preview(projectId, { retentionDays: Number(retentionDays) });
      setPreview(result);
      setNotice(result.eligible
        ? 'Preview ready: ' + result.totals.eligibleFiles + ' file(s), ' + formatBytes(result.totals.eligibleBytes) + ' can be quarantined.'
        : 'Cleanup is not eligible. Review the reported reasons; nothing was changed.');
    } catch (previewError) {
      setError(previewError);
    } finally {
      setBusy(false);
    }
  }

  async function startCleanup() {
    setBusy(true);
    setError(null);
    try {
      const record = await api().cleanup.start(projectId, { retentionDays: Number(retentionDays) });
      setPreview(null);
      setNotice('Quarantined ' + record.movedCount + ' file(s), ' + formatBytes(record.bytesQuarantined) + '. Files are restorable until ' + formatDate(record.restoreBy) + '.');
      await refresh();
    } catch (startError) {
      setError(startError);
    } finally {
      setBusy(false);
    }
  }

  async function restore(cleanupId: string) {
    setBusy(true);
    setError(null);
    try {
      const record = await api().cleanup.restore(projectId, cleanupId);
      setNotice('Restored ' + record.movedCount + ' file(s) from quarantine.');
      await refresh();
    } catch (restoreError) {
      setError(restoreError);
    } finally {
      setBusy(false);
    }
  }

  async function purge(cleanupId: string) {
    setBusy(true);
    setError(null);
    try {
      const record = await api().cleanup.purge(projectId, cleanupId, forcePurge);
      setNotice('Purged quarantine. Measured reclaimed space: ' + formatBytes(record.bytesReclaimed) + '.');
      await refresh();
    } catch (purgeError) {
      setError(purgeError);
    } finally {
      setBusy(false);
    }
  }

  async function resumeCleanup(cleanupId: string) {
    setBusy(true);
    setError(null);
    try {
      await api().cleanup.resume(projectId, cleanupId);
      setNotice('Cleanup resumed and completed.');
      await refresh();
    } catch (resumeError) {
      setError(resumeError);
    } finally {
      setBusy(false);
    }
  }

  async function exportHistory() {
    setBusy(true);
    setError(null);
    try {
      const snapshot = await api().history.export(projectId, 'manual-export');
      setNotice('History snapshot written: ' + snapshot.relativePath + ' (' + snapshot.entries + ' entries).');
    } catch (exportError) {
      setError(exportError);
    } finally {
      setBusy(false);
    }
  }

  async function exportBundle() {
    setBusy(true);
    setError(null);
    try {
      const exported = await api().diagnostics.export(projectId);
      setBundle(exported);
      setNotice('Support bundle exported. Secrets, cookies, wallet material and content bodies are excluded.');
    } catch (exportError) {
      setError(exportError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row between wrap gap">
        <div>
          <p className="eyebrow">Recovery, cleanup and durable history</p>
          <h1>Project recovery</h1>
          <p className="muted">Interrupted operations resume from durable checkpoints. Ambiguous publications are reconciled by exact read-back and never resubmitted automatically.</p>
        </div>
        <div className="row gap">
          <button className="ghost" onClick={() => void onBack()}>Dashboard</button>
          <button onClick={() => void refresh()} disabled={busy}>Refresh</button>
        </div>
      </div>

      <ErrorText error={error} />
      {notice && <div className="notice">{notice}</div>}

      <div className="stat-grid">
        <div className="stat"><span className="stat-label">Interrupted operations</span><strong>{status?.recovery.interruptedRuns ?? 0}</strong></div>
        <div className="stat"><span className="stat-label">Resumable</span><strong>{status?.recovery.resumableRuns ?? 0}</strong></div>
        <div className="stat"><span className="stat-label">Ambiguous publications</span><strong>{status?.recovery.ambiguousResources ?? 0}</strong></div>
        <div className="stat"><span className="stat-label">Corrupt checkpoints</span><strong>{status?.recovery.corruptCheckpoints ?? 0}</strong></div>
        <div className="stat"><span className="stat-label">Quarantined cleanups</span><strong>{cleanups.filter((entry) => entry.status === 'quarantined').length}</strong></div>
        <div className="stat"><span className="stat-label">History entries loaded</span><strong>{timeline.length}</strong></div>
      </div>

      {(status?.recovery.corruptCheckpoints ?? 0) > 0 && (
        <Alert tone="warn" title="Corrupt recovery checkpoint">
          A checkpoint file could not be read. The affected operation is shown as not resumable and nothing is retried automatically. The rest of the project remains usable.
        </Alert>
      )}

      <Card title="Interrupted operations" subtitle="Resume re-runs the step idempotently from the last durable checkpoint. It never duplicates downloads or publishes twice.">
        {candidates.length === 0 && <p className="muted">No interrupted operations. Every run finished or was cancelled cleanly.</p>}
        {candidates.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Operation</th><th>State</th><th>Checkpoint</th><th>Resumable</th><th></th></tr></thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.stageId ?? candidate.runId ?? candidate.kind}>
                    <td>{candidate.kind}</td>
                    <td><Badge tone={toneForStatus(candidate.state)}>{candidate.state}</Badge></td>
                    <td>
                      {candidate.phase ?? '—'} / {candidate.step ?? '—'} ({candidate.cursor}/{candidate.total})
                      {candidate.kind === 'source.discover' && (candidate.action?.params as Record<string, unknown> | undefined)?.mode === 'quick' && (
                        <span className="small muted"> · quick scan, up to {String(((candidate.action?.params as Record<string, unknown>).selection as Record<string, unknown> | undefined)?.maxItems ?? '?')} item(s)</span>
                      )}
                      {candidate.kind === 'source.discover' && (candidate.action?.params as Record<string, unknown> | undefined)?.mode === 'full' && (
                        <span className="small warn-text"> · full inventory</span>
                      )}
                    </td>
                    <td>{candidate.resumable ? 'yes' : 'no'}</td>
                    <td>
                      <div className="row gap">
                        <button
                          className="primary"
                          disabled={busy || !candidate.resumable}
                          title={candidate.resumable ? candidate.resumeHint : 'No safe automatic continuation.'}
                          onClick={() => void resume(candidate)}
                        >
                          Resume
                        </button>
                        {candidate.runId && (
                          <button className="ghost" disabled={busy} onClick={() => void dismiss(candidate)}>Dismiss</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {ambiguous.length > 0 && (
        <Card title="Ambiguous publications" subtitle="Submission result is unknown. Reconcile with an exact QDN read-back; this view never submits or signs a transaction.">
          <label className="field">
            <span className="field-label">Qortal node URL for read-back</span>
            <input value={nodeUrl} onChange={(event) => setNodeUrl(event.target.value)} placeholder="http://127.0.0.1:12391" aria-label="Qortal node URL for read-back" />
          </label>
          <div className="stack-sm">
            {ambiguous.map((resource) => (
              <div className="conflict" key={resource.resourceId}>
                <div>
                  <strong>{resource.service} · {resource.identifier}</strong>
                  <p className="small muted">{resource.reason ?? 'Submission state is unknown.'}</p>
                  <p className="small muted wrap-anywhere">SHA-256: {resource.sha256 ?? '—'} · tx: {short(resource.txSignature)}</p>
                </div>
                <button
                  className="primary"
                  disabled={busy || nodeUrl.trim() === ''}
                  onClick={() => void reconcile(resource.handoffId)}
                >
                  Reconcile read-back
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Two-phase cleanup" subtitle="Phase 1 quarantines eligible files; phase 2 purges after the retention window. Shared media, state, manifests, receipts, history and recovery checkpoints are protected.">
        <div className="row wrap gap">
          <label className="field">
            <span className="field-label">Retention days</span>
            <input
              type="number"
              min="0"
              max="3650"
              value={retentionDays}
              onChange={(event) => setRetentionDays(event.target.value)}
              aria-label="Cleanup retention days"
            />
          </label>
          <button className="primary" disabled={busy} onClick={() => void previewCleanup()}>Preview cleanup</button>
          <label className="row gap small">
            <input type="checkbox" checked={forcePurge} onChange={(event) => setForcePurge(event.target.checked)} />
            Allow purge before retention ends (irreversible)
          </label>
        </div>

        {preview && (
          <div className="stack-sm">
            <Alert tone={preview.eligible ? 'info' : 'warn'} title={preview.eligible ? 'Cleanup is eligible' : 'Cleanup is refused'}>
              {preview.totals.eligibleFiles} eligible file(s), {formatBytes(preview.totals.eligibleBytes)}; {preview.totals.protectedFiles} protected file(s), {formatBytes(preview.totals.protectedBytes)}; {preview.totals.unsafeFiles} unsafe path(s).
              {preview.refusedHandoffs.length > 0 && (
                <ul className="compact-list">
                  {preview.refusedHandoffs.map((entry) => (
                    <li key={entry.handoffId}>{entry.handoffId}: {entry.status} — exact read-back verification is required before cleanup.</li>
                  ))}
                </ul>
              )}
            </Alert>
            <div className="row wrap gap">
              <button className="primary" disabled={busy || !preview.eligible} onClick={() => void startCleanup()}>
                Quarantine eligible files
              </button>
              <span className="muted small">Files remain restorable until the retention window ends.</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Category</th><th>Path</th><th>Size</th><th>Status</th></tr></thead>
                <tbody>
                  {preview.items.slice(0, 200).map((item) => (
                    <tr key={item.relativePath}>
                      <td>{item.category}</td>
                      <td><code className="wrap-anywhere">{item.relativePath}</code></td>
                      <td>{formatBytes(item.bytes)}</td>
                      <td><Badge tone={item.eligible ? 'good' : 'warn'}>{item.eligible ? 'eligible' : (item.reason ?? 'protected')}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {cleanups.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Cleanup</th><th>Status</th><th>Files</th><th>Quarantined</th><th>Reclaimed</th><th>Restore by</th><th></th></tr></thead>
              <tbody>
                {cleanups.map((record) => (
                  <tr key={record.cleanupId}>
                    <td><code>{record.cleanupId}</code></td>
                    <td><Badge tone={toneForStatus(record.status)}>{record.status}</Badge></td>
                    <td>{record.movedCount}/{record.fileCount}</td>
                    <td>{formatBytes(record.bytesQuarantined)}</td>
                    <td>{formatBytes(record.bytesReclaimed)}</td>
                    <td>{formatDate(record.restoreBy)}</td>
                    <td>
                      <div className="row gap">
                        {(record.status === 'quarantining' || record.status === 'partial') && (
                          <button disabled={busy} onClick={() => void resumeCleanup(record.cleanupId)}>Resume cleanup</button>
                        )}
                        {['quarantined', 'partial'].includes(record.status) && (
                          <button className="ghost" disabled={busy} onClick={() => void restore(record.cleanupId)}>Restore</button>
                        )}
                        {record.status === 'quarantined' && (
                          <button className="ghost" disabled={busy} onClick={() => void purge(record.cleanupId)}>Purge</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Migration history" subtitle="Publication evidence, tx signatures, content hashes, status transitions, recovery and cleanup records. Stored in a hash-chained audit ledger that survives media cleanup." actions={
        <>
          <select value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value)} aria-label="History type filter">
            <option value="all">All types ({timeline.length})</option>
            {historyTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <button className="ghost" disabled={busy} onClick={() => void exportHistory()}>Export history snapshot</button>
        </>
      }>
        {visibleHistory.length === 0 && <p className="muted">No history entries yet.</p>}
        {visibleHistory.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Type</th><th>Status</th><th>Content hash</th><th>Tx signature</th></tr></thead>
              <tbody>
                {visibleHistory.slice(0, 200).map((entry) => (
                  <tr key={entry.id + ':' + (entry.seq ?? '')}>
                    <td>{formatDate(entry.at)}</td>
                    <td>{entry.type}</td>
                    <td><Badge tone={toneForStatus(String(entry.status ?? ''))}>{entry.status ?? '—'}</Badge></td>
                    <td><code title={entry.contentHash ?? ''}>{short(entry.contentHash)}</code></td>
                    <td><code title={entry.txSignature ?? ''}>{short(entry.txSignature)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Support bundle" subtitle="Metadata-only export for diagnostics. Credentials, cookies, wallet material and content bodies are excluded and verified before writing.">
        <div className="row wrap gap">
          <button className="primary" disabled={busy} onClick={() => void exportBundle()}>Export support bundle</button>
          {bundle && <span className="pill">{bundle.bytes} bytes · {formatDate(bundle.createdAt)}</span>}
        </div>
        {bundle && <p className="small muted wrap-anywhere">{bundle.path}</p>}
      </Card>
    </div>
  );
}

