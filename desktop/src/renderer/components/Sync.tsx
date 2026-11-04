import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import type {
  QmsEvent,
  SyncAdoptionReport,
  SyncCheckResult,
  SyncConflict,
  SyncPlanResult,
  SyncScanSummary,
  SyncStatus,
  SyncTombstoneResult
} from '../../shared/types.js';
import { Alert, Badge, Card, ErrorText, Field, ProgressBar } from './Common.js';
import { formatBytes, formatDate, shortId } from '../format.js';

interface SyncViewProps {
  projectId: string;
  onBack: () => void;
  onPublishing: (planId: string) => void;
}

const RESOLUTIONS: Record<string, Array<{ value: string; label: string }>> = {
  QDN_EXTERNAL_CHANGE: [
    { value: 'take_source', label: 'Authorize source overwrite' },
    { value: 'keep_qdn', label: 'Keep QDN version' },
    { value: 'skip', label: 'Skip this item' }
  ],
  WITHDRAWAL_CONFLICT: [
    { value: 'withdraw_local', label: 'Withdraw locally' },
    { value: 'keep_published', label: 'Keep published' },
    { value: 'tombstone', label: 'Prepare tombstone' }
  ],
  SOURCE_CHANGED_SINCE_SCAN: [
    { value: 'replan', label: 'Re-plan from source' },
    { value: 'skip', label: 'Skip this item' }
  ],
  IDENTITY_COLLISION: [
    { value: 'alternate', label: 'Use alternate identifier' },
    { value: 'skip', label: 'Skip this item' },
    { value: 'abort', label: 'Abort publication' }
  ],
  IDENTITY_MAPPING_CONFLICT: [
    { value: 'alternate', label: 'Use alternate identifier' },
    { value: 'skip', label: 'Skip this item' },
    { value: 'abort', label: 'Abort publication' }
  ],
  IDENTITY_MIGRATION_REQUIRED: [
    { value: 'alternate', label: 'Use alternate identifier' },
    { value: 'abort', label: 'Abort publication' }
  ]
};

function statusTone(status: string): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (status === 'completed') return 'good';
  if (status === 'failed' || status === 'cancelled') return 'bad';
  if (status === 'incomplete' || status === 'interrupted') return 'warn';
  return 'info';
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function countLabel(counts: SyncScanSummary['counts'] | null | undefined, key: keyof SyncScanSummary['counts']): number {
  return counts?.[key] ?? 0;
}

export function SyncView({ projectId, onBack, onPublishing }: SyncViewProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [scan, setScan] = useState<SyncScanSummary | null>(null);
  const [history, setHistory] = useState<SyncScanSummary[]>([]);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [adoptions, setAdoptions] = useState<SyncAdoptionReport[]>([]);
  const [withdrawals, setWithdrawals] = useState<Array<Record<string, unknown>>>([]);
  const [lastResult, setLastResult] = useState<SyncCheckResult | null>(null);
  const [planResult, setPlanResult] = useState<SyncPlanResult | null>(null);
  const [tombstones, setTombstones] = useState<SyncTombstoneResult | null>(null);
  const [fullReconciliation, setFullReconciliation] = useState(false);
  const [autoWithdrawals, setAutoWithdrawals] = useState(true);
  const [withdrawalPolicy, setWithdrawalPolicy] = useState('hide');
  const [busy, setBusy] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [lastProgress, setLastProgress] = useState<{ completed: number; total: number; bytes: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);

  async function refresh() {
    const [nextStatus, nextConflicts, nextAdoptions, nextHistory, nextWithdrawals] = await Promise.all([
      api().sync.status(projectId),
      api().sync.conflicts(projectId, true),
      api().sync.adoptions(projectId),
      api().sync.history(projectId, 20),
      api().sync.withdrawals(projectId)
    ]);
    if (!mounted.current) return;
    setStatus(nextStatus);
    setScan(nextStatus.latestScan);
    setConflicts(nextConflicts);
    setAdoptions(nextAdoptions);
    setHistory(nextHistory);
    setWithdrawals(nextWithdrawals);
    if (nextStatus.preferences && typeof nextStatus.preferences.autoApplyWithdrawals === 'boolean') {
      setAutoWithdrawals(nextStatus.preferences.autoApplyWithdrawals);
    }
    if (nextStatus.preferences && typeof nextStatus.preferences.withdrawalPolicy === 'string') {
      setWithdrawalPolicy(nextStatus.preferences.withdrawalPolicy);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void refresh().catch((refreshError) => {
      if (mounted.current) setError(refreshError);
    });
    const unsubscribe = api().events.on((payload) => {
      const event = payload as QmsEvent;
      if (event.project_id !== projectId) return;
      if (!mounted.current) return;
      if (event.run_id && (event.type === 'operation_started' || event.type === 'progress_updated')) {
        setCurrentRunId(event.run_id);
      }
      if (event.progress) setLastProgress(event.progress);
      if (event.type === 'operation_completed' || event.type === 'operation_failed' || event.type === 'operation_cancelled') {
        setCurrentRunId(null);
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openConflicts = useMemo(
    () => conflicts.filter((conflict) => conflict.status !== 'resolved'),
    [conflicts]
  );
  const withdrawnEntries = scan?.delta.withdrawn ?? [];
  const pendingWithdrawals = scan?.counts.withdrawn ?? 0;
  const deltaKeys = useMemo(
    () => [...(scan?.delta.new ?? []), ...(scan?.delta.modified ?? [])].map((entry) => entry.sourceKey),
    [scan]
  );

  async function checkForUpdates() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setPlanResult(null);
    setTombstones(null);
    setLastProgress(null);
    try {
      const result = await api().sync.check(projectId, {
        mode: fullReconciliation ? 'full' : 'auto',
        autoApplyWithdrawals: autoWithdrawals,
        withdrawalPolicy,
        perPage: 100
      });
      if (!mounted.current) return;
      setLastResult(result);
      if (result.status === 'failed' || result.status === 'cancelled') {
        setNotice('The scan did not complete. No changes were assumed or reported.');
      } else if (result.status === 'incomplete') {
        setNotice('The scan is incomplete. Deletions were not inferred and no publication plan may be prepared.');
      } else {
        setNotice('Scan completed. Review the delta before preparing publication.');
      }
      await refresh();
      setPlanResult(null);
    } catch (checkError) {
      if (mounted.current) setError(checkError);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function resumeScan() {
    if (!scan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api().sync.resume(projectId, scan.scanId);
      if (!mounted.current) return;
      setLastResult(result);
      setNotice(result.status === 'interrupted' ? 'Scan paused again at a checkpoint. Resume to continue.' : 'Scan resumed and finished.');
      await refresh();
    } catch (resumeError) {
      if (mounted.current) setError(resumeError);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function cancelScan() {
    if (!currentRunId) return;
    setError(null);
    try {
      await api().runs.cancel(projectId, currentRunId);
      setNotice('Cancellation requested. A cancelled scan is not a successful sync.');
    } catch (cancelError) {
      if (mounted.current) setError(cancelError);
    }
  }

  async function adoptExisting() {
    setBusy(true);
    setError(null);
    try {
      const report = await api().sync.adopt(projectId, 'Existing migration adopted from the synchronization view.');
      if (!mounted.current) return;
      setNotice(report.message);
      await refresh();
    } catch (adoptError) {
      if (mounted.current) setError(adoptError);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function preparePlan() {
    if (!scan || deltaKeys.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api().sync.plan(projectId, scan.scanId, {
        selection: deltaKeys,
        estimateMedia: true
      });
      if (!mounted.current) return;
      setPlanResult(result);
      if (result.noChanges) setNotice(result.message ?? 'No new or modified content was found.');
      else setNotice('Delta publication plan prepared. Only new and modified resources are included.');
      await refresh();
    } catch (planError) {
      if (mounted.current) setError(planError);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function resolveConflict(conflict: SyncConflict, resolution: string) {
    setResolvingId(conflict.id);
    setError(null);
    try {
      const resolved = await api().sync.resolveConflict(
        projectId,
        conflict.id,
        resolution,
        'Operator decision recorded in the synchronization view.'
      );
      if (!mounted.current) return;
      setNotice('Conflict ' + shortId(resolved.id) + ' resolved as ' + resolution.replace(/_/g, ' ') + '.');
      await refresh();
    } catch (resolveError) {
      if (mounted.current) setError(resolveError);
    } finally {
      if (mounted.current) setResolvingId(null);
    }
  }

  async function applyWithdrawals() {
    if (!scan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api().sync.withdraw(projectId, scan.scanId, {
        policy: withdrawalPolicy,
        sourceKeys: withdrawnEntries.map((entry) => entry.sourceKey)
      });
      if (!mounted.current) return;
      setNotice(result.message ?? 'Local withdrawal recorded. Published QDN data was not deleted.');
      await refresh();
    } catch (withdrawError) {
      if (mounted.current) setError(withdrawError);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function prepareTombstones() {
    if (!scan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api().sync.prepareTombstones(projectId, scan.scanId, {
        sourceKeys: withdrawnEntries.map((entry) => entry.sourceKey)
      });
      if (!mounted.current) return;
      setTombstones(result);
      setNotice(result.message);
      await refresh();
    } catch (tombstoneError) {
      if (mounted.current) setError(tombstoneError);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function continueToPublishing() {
    if (planResult?.planId) onPublishing(planResult.planId);
  }

  const failed = lastResult?.status === 'failed' || lastResult?.status === 'cancelled' || scan?.status === 'failed' || scan?.status === 'cancelled';
  const incomplete = !failed && (lastResult?.status === 'incomplete' || scan?.status === 'incomplete');
  const interrupted = !failed && (!lastResult?.status || lastResult.status === 'interrupted' || scan?.status === 'interrupted');

  return (
    <div className="stack" data-testid="sync-view">
      <div className="hero">
        <div>
          <p className="eyebrow">Phase 7 · incremental synchronization</p>
          <h1>Check for updates</h1>
          <p className="muted">
            Compares WordPress with the persistent identity mappings and prepares only new or modified resources.
            Nothing is signed or published here; approved batches continue through the existing Hub handoff.
          </p>
        </div>
        <div className="row wrap gap">
          <button onClick={onBack}>Dashboard</button>
          <button className="primary" onClick={() => void checkForUpdates()} disabled={busy}>
            {busy ? 'Scanning…' : 'Check for updates'}
          </button>
        </div>
      </div>

      <ErrorText error={error} />
      {notice && <div className="notice" data-testid="sync-notice">{notice}</div>}

      <Card title="Scan settings" subtitle="Manual scans only. There is no scheduled background sync." testId="sync-settings">
        <div className="grid-2">
          <label className="checkbox">
            <input type="checkbox" checked={fullReconciliation} onChange={(event) => setFullReconciliation(event.target.checked)} />
            Full reconciliation (detects deletions and missed changes)
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={autoWithdrawals} onChange={(event) => setAutoWithdrawals(event.target.checked)} />
            Apply default local withdrawal after a complete scan
          </label>
          <Field label="Withdrawal policy" hint="Local hide is the default. It never deletes published QDN data.">
            <select value={withdrawalPolicy} onChange={(event) => setWithdrawalPolicy(event.target.value)}>
              <option value="hide">Hide locally</option>
              <option value="review">Review each withdrawal</option>
              <option value="keep">Keep published</option>
              <option value="tombstone">Hide locally and prepare tombstones</option>
            </select>
          </Field>
          <div className="row wrap gap align-end">
            {currentRunId && <button className="ghost" onClick={() => void cancelScan()}>Cancel scan</button>}
            <span className="muted small">
              {currentRunId ? 'Operation ' + shortId(currentRunId) + ' in progress' : 'Ready'}
            </span>
          </div>
        </div>
        {busy && (
          <div className="stack-sm" style={{ marginTop: '0.8rem' }}>
            <ProgressBar completed={lastProgress?.completed ?? 0} total={lastProgress?.total ?? 0} />
            <span className="muted small">
              {lastProgress ? lastProgress.completed + ' / ' + lastProgress.total + ' items' : 'Starting scan…'}
            </span>
          </div>
        )}
      </Card>

      {status?.adoptionRequired && (
        <Card title="Existing migration adoption" subtitle="Phase 3–6 mappings are preserved exactly; this never rewrites verified identities." testId="sync-adoption">
          <p>
            This project already has {status.counts.mappings} identity mapping(s) but no Phase 7 synchronization watermark.
            Adopt it to enable incremental scans without changing any QDN identity or publication receipt.
          </p>
          <button className="primary" onClick={() => void adoptExisting()} disabled={busy}>Adopt existing migration</button>
        </Card>
      )}

      {adoptions.length > 0 && (
        <Card title="Adoption evidence" subtitle="Read-only reconciliation reports survive a restart.">
          {adoptions.slice(0, 3).map((report) => (
            <div key={report.adoptedAt} className="stack-sm">
              <div className="row wrap gap">
                <Badge tone={report.issues.length === 0 ? 'good' : 'warn'}>{report.issues.length === 0 ? 'adopted' : report.issues.length + ' issue(s)'}</Badge>
                <span className="muted small">{formatDate(report.adoptedAt)} · {report.mappingCount} mappings · {report.verifiedResourceCount} verified resources</span>
              </div>
              <p className="small">{report.message}</p>
              {report.issues.slice(0, 5).map((issue) => (
                <p className="small warn-text" key={issue.code + (issue.sourceKey ?? '')}>{issue.code}: {issue.message}</p>
              ))}
            </div>
          ))}
        </Card>
      )}

      {scan && (
        <Card
          title="Synchronization result"
          subtitle="Counts are explicit; a failed or incomplete scan is never reported as no changes."
          testId="sync-result"
          actions={<Badge tone={statusTone(scan.status)}>{statusLabel(scan.status)}</Badge>}
        >
          <div className="meta-list" data-testid="sync-counts">
            <div><dt>New</dt><dd data-testid="count-new">{countLabel(scan.counts, 'new')}</dd></div>
            <div><dt>Modified</dt><dd data-testid="count-modified">{countLabel(scan.counts, 'modified')}</dd></div>
            <div><dt>Unchanged</dt><dd data-testid="count-unchanged">{countLabel(scan.counts, 'unchanged')}</dd></div>
            <div><dt>Withdrawn</dt><dd data-testid="count-withdrawn">{countLabel(scan.counts, 'withdrawn')}</dd></div>
            <div><dt>Conflicting</dt><dd data-testid="count-conflicts">{openConflicts.length}</dd></div>
            <div><dt>Unpublished</dt><dd data-testid="count-unpublished">{countLabel(scan.counts, 'unpublished')}</dd></div>
            <div><dt>Not checked</dt><dd data-testid="count-not-scanned">{countLabel(scan.counts, 'notScanned')}</dd></div>
          </div>
          <p className="muted small">
            Mode {scan.mode} · scanned {countLabel(scan.counts, 'scanned')} · started {formatDate(scan.startedAt)}
            {scan.completedAt ? ' · completed ' + formatDate(scan.completedAt) : ''}
          </p>
          {failed && (
            <Alert tone="bad">
              The scan failed or was cancelled. This is not a successful sync and must not be treated as “no changes”.
              {lastResult?.error?.message ? ' ' + lastResult.error.message : ''}
            </Alert>
          )}
          {incomplete && (
            <Alert tone="warn">
              This scan is incomplete or truncated. Deletions and watermarks were not inferred, and no delta plan may be prepared from it.
            </Alert>
          )}
          {interrupted && scan.status === 'interrupted' && (
            <div className="row wrap gap">
              <Alert tone="warn">The scan stopped at a crash-safe checkpoint. Resume it to continue; it is not complete.</Alert>
              <button className="primary" onClick={() => void resumeScan()} disabled={busy}>Resume scan</button>
            </div>
          )}
          {scan.warnings?.length > 0 && (
            <div className="stack-sm">
              {scan.warnings.slice(0, 6).map((warning) => (
                <p className="small warn-text" key={warning.code + warning.message}>{warning.code}: {warning.message}</p>
              ))}
            </div>
          )}
          <div className="row wrap gap" style={{ marginTop: '0.7rem' }}>
            {scan.planningAllowed && deltaKeys.length > 0 && (
              <button className="primary" onClick={() => void preparePlan()} disabled={busy}>
                Prepare delta publication plan ({deltaKeys.length} resources)
              </button>
            )}
            {scan.reportPath && <span className="muted small">Report: {scan.reportPath}</span>}
            {scan.catalogPath && <span className="muted small">Catalog: {scan.catalogPath}</span>}
          </div>
        </Card>
      )}

      {scan?.planningAllowed && deltaKeys.length === 0 && scan.status === 'completed' && (
        <Alert tone="good">No new or modified content was found in this completed scan. Nothing will be republished.</Alert>
      )}

      {planResult && (
        <Card title="Delta publication plan" subtitle="Only the changed resources are included. Fees are estimates, not a live quote." testId="sync-plan">
          {planResult.planId ? (
            <div className="stack-sm">
              <div className="row wrap gap">
                <Badge tone={planResult.status === 'ready' || planResult.status === 'completed' ? 'good' : 'warn'}>{planResult.status}</Badge>
                <span>{planResult.stats?.selected ?? 0} selected · {planResult.plan?.estimates?.totalResources ?? 0} resources</span>
                <span>Estimated fee {planResult.plan?.estimates?.estimatedFee ?? 0} {planResult.plan?.estimates?.feeCurrency ?? 'QORT'}</span>
                <span>Disk projected {formatBytes(Number(planResult.plan?.disk?.projectedBytes ?? 0))}</span>
              </div>
              {planResult.plan?.errors?.length ? (
                <Alert tone="bad">{planResult.plan.errors.map((entry) => entry.message).join(' ')}</Alert>
              ) : null}
              <button className="primary" onClick={continueToPublishing}>Continue to Hub publication</button>
              <span className="muted small">The existing Phase 5 handoff, receipt import and exact read-back verification are unchanged.</span>
            </div>
          ) : (
            <p>{planResult.message ?? 'No changed resources were selected.'}</p>
          )}
        </Card>
      )}

      {openConflicts.length > 0 && (
        <Card title={'Conflicts (' + openConflicts.length + ')'} subtitle="Every decision is persisted with source, local and QDN evidence." testId="sync-conflicts">
          <div className="stack">
            {openConflicts.map((conflict) => (
              <div className="stack-sm" key={conflict.id} data-testid={'conflict-' + conflict.id}>
                <div className="row wrap gap">
                  <Badge tone="bad">{conflict.kind.replace(/_/g, ' ')}</Badge>
                  <strong>{conflict.sourceKey}</strong>
                  <span className="muted small">detected {formatDate(conflict.createdAt)}</span>
                </div>
                <p className="small muted">
                  Local hash {String((conflict.evidence.local as Record<string, unknown> | undefined)?.mapping
                    ? ((conflict.evidence.local as { mapping?: { contentHash?: string } }).mapping?.contentHash ?? 'unknown')
                    : 'unknown')}
                  {' · '}
                  QDN hash {String((conflict.evidence.qdn as Record<string, unknown> | undefined)?.sha256 ?? 'not supplied')}
                </p>
                <div className="row wrap gap">
                  {(RESOLUTIONS[conflict.kind] ?? [{ value: 'skip', label: 'Skip' }]).map((option) => (
                    <button
                      key={option.value}
                      className={option.value === 'take_source' ? 'primary' : 'ghost'}
                      disabled={resolvingId === conflict.id}
                      onClick={() => void resolveConflict(conflict, option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {conflict.kind === 'QDN_EXTERNAL_CHANGE' && (
                  <p className="small warn-text">
                    The existing QDN resource will never be overwritten until “Authorize source overwrite” is selected.
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {(withdrawnEntries.length > 0 || status?.counts.withdrawn) ? (
        <Card title="Withdrawals" subtitle="Local withdrawal hides content from the visible CMS catalog. It never deletes published QDN data." testId="sync-withdrawals">
          <p className="small">
            {status?.counts.withdrawn ?? 0} mapping(s) are locally withdrawn.
            {scan?.withdrawals?.appliedCount ? ' ' + scan.withdrawals.appliedCount + ' withdrawal(s) were applied by this scan.' : ''}
          </p>
          {withdrawnEntries.length > 0 && (
            <div className="stack-sm">
              {withdrawnEntries.slice(0, 10).map((entry) => (
                <p className="small" key={entry.sourceKey}>
                  <strong>{entry.sourceKey}</strong> · {entry.reason ?? 'source withdrawn'}
                </p>
              ))}
              <div className="row wrap gap">
                {scan?.status === 'completed' && (
                  <button className="primary" onClick={() => void applyWithdrawals()} disabled={busy}>Apply withdrawal policy</button>
                )}
                <button className="ghost" onClick={() => void prepareTombstones()} disabled={busy}>Prepare tombstones only</button>
              </div>
              <p className="small muted">
                Preparing a tombstone writes a local marker with networkDeleted=false. It does not publish or delete anything.
              </p>
            </div>
          )}
          {tombstones && (
            <div className="stack-sm" data-testid="sync-tombstones">
              <Badge tone="warn">{tombstones.preparedCount} prepared · not published</Badge>
              {tombstones.prepared.map((entry) => (
                <p className="small" key={entry.sourceKey}>{entry.sourceKey} → {entry.relativePath}</p>
              ))}
            </div>
          )}
          {withdrawals.length > 0 && (
            <p className="small muted">{withdrawals.length} durable withdrawal audit record(s) preserved.</p>
          )}
        </Card>
      ) : null}

      <Card title="Synchronization history" subtitle="Persisted locally and recoverable after restart." testId="sync-history">
        {history.length === 0 ? <p className="muted">No scans yet.</p> : (
          <div className="stack-sm">
            {history.map((entry) => (
              <div className="row wrap gap" key={entry.scanId}>
                <Badge tone={statusTone(entry.status)}>{statusLabel(entry.status)}</Badge>
                <span className="small">{shortId(entry.scanId)} · {entry.mode}</span>
                <span className="muted small">
                  {formatDate(entry.startedAt)} · new {entry.counts.new} · modified {entry.counts.modified} ·
                  unchanged {entry.counts.unchanged} · withdrawn {entry.counts.withdrawn}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
