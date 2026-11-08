import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type {
  PlanDocument,
  PlanRecord,
  PublicationBundleExport,
  PublicationHandoffDetail,
  PublicationHandoffSummary,
  PublicationPrepareResult,
  PublicationVerifyResult,
  NodeSettings,
  NodeTestResult,
  QmsEvent
} from '../../shared/types.js';
import { Alert, Badge, Card, ErrorText, Field } from './Common.js';
import { formatBytes, formatDate, shortId } from '../format.js';

const ACTIONABLE = new Set(['new', 'modified', 'route_changed', 'reserved']);
const STATUS_TONES: Record<string, 'neutral' | 'good' | 'warn' | 'bad' | 'info'> = {
  reserved: 'warn',
  prepared: 'warn',
  handoff_ready: 'info',
  submitted: 'info',
  pending_confirmation: 'warn',
  remote_verified: 'good',
  failed: 'bad',
  partial: 'warn',
  ambiguous: 'warn',
  declined: 'neutral',
  blocked: 'bad'
};

function tone(status: string) {
  return STATUS_TONES[status] ?? 'neutral';
}

function statusLabel(status: unknown): string {
  const value = String(status ?? 'unknown');
  return value.replace(/_/g, ' ');
}

/**
 * A publication resource may carry its publication state in "status" and its
 * handoff preparation state in "state" (older prepared records had only
 * "state"). Rendering must tolerate either shape; dereferencing a missing
 * status used to throw inside the table and unmount the whole renderer.
 */
function resourceStatus(resource: { status?: string | null; state?: string | null }): string {
  return resource.status ?? resource.state ?? 'handoff_ready';
}

export function Publishing({ projectId, initialPlanId = null, onBack }: { projectId: string; initialPlanId?: string | null; onBack: () => void }) {
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [handoffs, setHandoffs] = useState<PublicationHandoffSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState(initialPlanId ?? '');
  const [plan, setPlan] = useState<PlanDocument | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectedHandoffId, setSelectedHandoffId] = useState('');
  const [handoff, setHandoff] = useState<PublicationHandoffDetail | null>(null);
  const [prepared, setPrepared] = useState<PublicationPrepareResult | null>(null);
  const [bundle, setBundle] = useState<PublicationBundleExport | null>(null);
  const [receiptText, setReceiptText] = useState('');
  const [nodeUrl, setNodeUrl] = useState('http://127.0.0.1:12391');
  const [nodeSettings, setNodeSettings] = useState<NodeSettings | null>(null);
  const [nodeTest, setNodeTest] = useState<NodeTestResult | null>(null);
  const [nodeTesting, setNodeTesting] = useState(false);
  const [attempts, setAttempts] = useState(6);
  const [verification, setVerification] = useState<PublicationVerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [prepareProgress, setPrepareProgress] = useState<{ phase: string; completed: number; total: number; message: string } | null>(null);
  const [prepareStartedAt, setPrepareStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  async function refresh() {
    const [planList, handoffList] = await Promise.all([
      api().plans.list(projectId, 100),
      api().publication.list(projectId)
    ]);
    setPlans(planList);
    setHandoffs(handoffList);
    if (!selectedPlanId) {
      const ready = planList.find((entry) => entry.status === 'ready');
      if (ready) setSelectedPlanId(ready.planId);
    } else if (initialPlanId && planList.some((entry) => entry.planId === initialPlanId)) {
      setSelectedPlanId(initialPlanId);
    }
    if (!selectedHandoffId && handoffList.length > 0) {
      setSelectedHandoffId(handoffList[0].handoffId);
    }
  }

  useEffect(() => {
    void refresh().catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    api().nodes.get()
      .then((settings) => {
        setNodeSettings(settings);
        setNodeUrl(settings.selected ?? settings.defaultNode);
      })
      .catch(() => {
        // Node settings are optional; preparation still works fully offline.
      });
  }, []);

  useEffect(() => {
    const unsubscribe = api().events.on((payload) => {
      const event = payload as QmsEvent;
      if (event.project_id !== projectId) return;
      if (!event.progress) return;
      const service = (event.details as Record<string, unknown> | undefined)?.service;
      if (service !== 'publication.prepare') return;
      setPrepareProgress({
        phase: String(event.phase ?? 'prepare'),
        completed: Number(event.progress.completed ?? 0),
        total: Number(event.progress.total ?? 0),
        message: event.message ?? ''
      });
    });
    return unsubscribe;
  }, [projectId]);

  useEffect(() => {
    if (!prepareStartedAt) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - prepareStartedAt) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [prepareStartedAt]);

  useEffect(() => {
    if (!selectedPlanId) {
      setPlan(null);
      setSelection(new Set());
      return;
    }
    api().plans.get(projectId, selectedPlanId)
      .then((result) => {
        setPlan(result.plan);
        setSelection(new Set(result.plan.entries
          .filter((entry) => ACTIONABLE.has(entry.status) && entry.qdn)
          .map((entry) => entry.sourceKey)));
        setError(null);
      })
      .catch(setError);
  }, [projectId, selectedPlanId]);

  useEffect(() => {
    if (!selectedHandoffId) {
      setHandoff(null);
      return;
    }
    api().publication.get(projectId, selectedHandoffId)
      .then((result) => {
        setHandoff(result);
        setError(null);
      })
      .catch(setError);
  }, [projectId, selectedHandoffId]);

  const actionable = useMemo(
    () => (plan?.entries ?? []).filter((entry) => ACTIONABLE.has(entry.status) && entry.qdn),
    [plan]
  );
  function toggle(sourceKey: string) {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(sourceKey)) next.delete(sourceKey);
      else next.add(sourceKey);
      return next;
    });
  }

  async function prepareHandoff() {
    if (!plan || selection.size === 0) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    setPrepared(null);
    setPrepareProgress(null);
    setPrepareStartedAt(Date.now());
    setElapsedSeconds(0);
    try {
      const result = await api().publication.prepare(projectId, plan.planId, [...selection], {
        feePerResource: plan.estimates?.feePerResource
      });
      setPrepared(result);
      setMessage(result.reused
        ? 'An equivalent handoff already existed; it was reopened instead of duplicating QDN identities.'
        : 'Handoff package created and every payload hash was verified locally.');
      await refresh();
      setSelectedHandoffId(result.handoffId);
    } catch (prepareError) {
      setError(prepareError);
      // The package may still have been written before a failure; reload the
      // handoff list so the user can see and export any completed artifact.
      await refresh().catch(() => {});
    } finally {
      setLoading(false);
      setPrepareStartedAt(null);
    }
  }

  const siteResource = handoff?.resources.find((resource) => resource.kind === 'site') ?? null;

  async function openPublishedSite() {
    if (!siteResource) return;
    const base = nodeUrl.replace(/\/+$/, '');
    const service = siteResource.service === 'WEBSITE' ? 'WEBSITE' : 'APP';
    const url = base + '/arbitrary/' + service + '/' + encodeURIComponent(siteResource.name) + '/' + encodeURIComponent(siteResource.identifier) + '?filepath=index.html';
    try {
      await api().app.openUrl(url);
    } catch (openError) {
      setError(openError);
    }
  }

  async function exportPublisherPackage() {
    const id = prepared?.handoffId ?? selectedHandoffId;
    if (!id) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api().publication.exportBundle(projectId, id);
      setBundle(result);
      setMessage('Publisher package exported. In Qortal Hub open the Migration Publisher Q-App and select this .zip file.');
    } catch (exportError) {
      setError(exportError);
    } finally {
      setLoading(false);
    }
  }

  async function openHandoffFolder() {
    const target = prepared?.absolutePath ?? handoff?.absolutePath;
    if (!target) return;
    try {
      await api().app.openPath(target);
    } catch (openError) {
      setError(openError);
    }
  }

  async function importReceipt() {
    if (!selectedHandoffId || receiptText.trim() === '') return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const receipt = JSON.parse(receiptText) as Record<string, unknown>;
      const result = await api().publication.importReceipt(projectId, selectedHandoffId, receipt);
      setMessage('Receipt imported as Publisher-reported evidence. Run independent QDN verification next.');
      setReceiptText('');
      setVerification(null);
      await refresh();
      setHandoff(await api().publication.get(projectId, selectedHandoffId));
      void result;
    } catch (importError) {
      setError(importError);
    } finally {
      setLoading(false);
    }
  }

  async function readReceiptFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setReceiptText(await file.text());
    } catch (readError) {
      setError(readError);
    }
  }

  async function saveNode(select: boolean) {
    setNodeTesting(true);
    setError(null);
    try {
      const settings = await api().nodes.set(nodeUrl, select);
      setNodeSettings(settings);
      setNodeUrl(settings.selected ?? nodeUrl);
      setMessage('Node saved. It is used only for read-only QDN verification.');
    } catch (saveError) {
      setError(saveError);
    } finally {
      setNodeTesting(false);
    }
  }

  async function testNode() {
    setNodeTesting(true);
    setError(null);
    try {
      setNodeTest(await api().nodes.test(nodeUrl));
    } catch (testError) {
      setError(testError);
      setNodeTest(null);
    } finally {
      setNodeTesting(false);
    }
  }

  async function verify() {
    if (!selectedHandoffId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api().publication.verify(projectId, selectedHandoffId, nodeUrl, { attempts });
      setVerification(result);
      setMessage(result.pendingOrUnverified === 0
        ? 'Exact read-back completed for every resource.'
        : 'Some resources remain pending or unverified; they were not marked published.');
      await refresh();
      setHandoff(await api().publication.get(projectId, selectedHandoffId));
    } catch (verifyError) {
      setError(verifyError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack" data-testid="publishing-view">
      <div className="row between wrap gap">
        <div>
          <p className="eyebrow">Phase 5 · Variant A</p>
          <h1>Publish through Qortal Hub</h1>
          <p className="muted">
            Prepare exact QDN bytes here, hand the folder to the Migration Publisher Q-App, then import
            its signed receipt. Hub signs and approves; this desktop app never sees wallet keys or seeds.
          </p>
        </div>
        <button className="ghost" type="button" onClick={onBack}>Back</button>
      </div>

      <ErrorText error={error} />
      {message && <Alert tone="good" title="Status">{message}</Alert>}

      <Card title="1. Prepare a portable handoff" subtitle="Resources are selected explicitly. Estimated fees are not a live quote.">
        <div className="grid-2">
          <Field label="Completed plan">
            <select value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)}>
              <option value="">Select a ready plan</option>
              {plans.filter((entry) => entry.status === 'ready').map((entry) => (
                <option key={entry.planId} value={entry.planId}>
                  {shortId(entry.planId)} · {entry.selectedCount} selected · {formatDate(entry.createdAt)}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <p className="muted small">
              Estimated fee: {plan ? plan.estimates.estimatedFee + ' ' + plan.estimates.feeCurrency : '—'} ·
              {' '}{plan ? plan.estimates.totalResources : 0} resources planned
            </p>
            <p className="hint">{plan?.estimates.note ?? 'Qortal Hub shows the current network fee before approval.'}</p>
          </div>
        </div>

        {actionable.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Use</th><th>Type</th><th>Title</th><th>QDN identifier</th><th>Status</th><th>Media</th></tr>
              </thead>
              <tbody>
                {actionable.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={'Select ' + entry.title}
                        checked={selection.has(entry.sourceKey)}
                        onChange={() => toggle(entry.sourceKey)}
                      />
                    </td>
                    <td>{entry.contentType}</td>
                    <td>{entry.title ?? '—'}</td>
                    <td><code>{entry.qdn.identifier}</code></td>
                    <td><Badge tone={entry.pendingPublication ? 'warn' : 'neutral'}>{entry.status}</Badge></td>
                    <td>{entry.mediaCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {plan && (
          <div data-testid="publication-safety">
            <Alert tone="warn" title="Before preparing a publication">
              <p>
                Target Qortal name: <strong>{String(plan.target.qdnName)}</strong>. APP and WEBSITE are separate deployments,
                and a different project identity always derives a different QDN identifier.
              </p>
              <p className="small">
                QMS never overwrites an existing deployment. A resource is updated only when this project republishes the exact
                service, name and identifier shown in the handoff table. Review the service column before approving in Qortal Hub.
              </p>
            </Alert>
          </div>
        )}
        <div className="row gap wrap">
          <button className="primary" type="button" disabled={!plan || selection.size === 0 || loading} onClick={() => void prepareHandoff()}>
            {loading ? 'Preparing handoff…' : 'Generate handoff package'}
          </button>
          <span className="muted">{selection.size} of {actionable.length} resources selected</span>
        </div>
        {loading && (
          <Alert tone="info" title="Preparing handoff">
            <p>
              {prepareProgress
                ? prepareProgress.message + (prepareProgress.total > 0
                  ? ' (' + prepareProgress.completed + ' / ' + prepareProgress.total + ')'
                  : '')
                : 'Starting local preparation. Payloads are written and hashed before anything is reported as ready.'}
            </p>
            <p className="small muted">
              Phase: {prepareProgress?.phase ?? 'starting'} · {elapsedSeconds}s elapsed. The project and verified downloads stay untouched if this takes longer.
            </p>
          </Alert>
        )}

        {prepared && (
          <Alert tone="info" title="Handoff ready">
            <p>{prepared.message}</p>
            <p><code>{prepared.absolutePath}</code></p>
            <p className="small">Export one .zip package and select it in Qortal Hub → Migration Publisher. The Publisher validates the manifest, every SHA-256 and any CMS application bundle (APP or WEBSITE) before asking for approval.</p>
            <div className="row gap wrap">
              <button type="button" className="primary" onClick={() => void exportPublisherPackage()} disabled={loading}>Export Publisher package (.zip)</button>
              <button type="button" className="ghost" onClick={() => void openHandoffFolder()}>Open handoff folder</button>
            </div>
            {bundle && (
              <div className="stack-sm">
                <p><code>{bundle.absolutePath}</code></p>
                <p className="small">{formatBytes(bundle.bytes)} · SHA-256 <code>{bundle.sha256}</code></p>
              </div>
            )}
          </Alert>
        )}
      </Card>

      <Card title="2. Import Publisher receipt and verify QDN" subtitle="Publisher-reported evidence is not proof. Exact read-back decides remote verification.">
        <div className="grid-2">
          <Field label="Handoff package">
            <select value={selectedHandoffId} onChange={(event) => { setSelectedHandoffId(event.target.value); setVerification(null); }}>
              <option value="">Select a handoff</option>
              {handoffs.map((entry) => (
                <option key={entry.handoffId} value={entry.handoffId}>
                  {shortId(entry.handoffId)} · {entry.status} · {entry.resourceCount} resources
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Qortal node for read-only verification"
            hint="Optional. Use a local node or an SSH-forwarded port such as http://127.0.0.1:24991. The desktop app works offline without a node."
          >
            <input value={nodeUrl} onChange={(event) => { setNodeUrl(event.target.value); setNodeTest(null); }} placeholder="http://127.0.0.1:24991" />
          </Field>
        </div>
        <div className="row wrap gap" data-testid="node-controls">
          {nodeSettings && nodeSettings.nodes.length > 0 && (
            <label className="text-size-control">
              <span className="small muted">Saved node</span>
              <select
                aria-label="Saved Qortal node"
                value={nodeSettings.nodes.includes(nodeUrl) ? nodeUrl : ''}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setNodeUrl(event.target.value);
                  setNodeTest(null);
                }}
              >
                <option value="">Custom / not saved</option>
                {nodeSettings.nodes.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </label>
          )}
          <button className="ghost" type="button" onClick={() => void testNode()} disabled={nodeTesting || !nodeUrl.trim()}>
            {nodeTesting ? 'Testing…' : 'Test connection'}
          </button>
          <button className="ghost" type="button" onClick={() => void saveNode(true)} disabled={nodeTesting || !nodeUrl.trim()}>
            Save as preferred node
          </button>
        </div>
        {nodeTest && (
          <Alert tone={nodeTest.ok ? 'good' : 'warn'} title={nodeTest.ok ? 'Node reachable' : 'Node not reachable'}>
            <p>{nodeTest.message}</p>
            <p className="small muted">
              {nodeTest.url} · {nodeTest.status === null ? 'no HTTP status' : 'HTTP ' + nodeTest.status} · {nodeTest.latencyMs} ms
              {nodeTest.height !== null ? ' · block ' + nodeTest.height : ''}
            </p>
            <p className="small muted">
              Only a public read-only endpoint was probed. QMS never enables or exposes a private node API and never changes SSH tunnels.
            </p>
          </Alert>
        )}

        <div className="grid-2">
          <Field label="Publisher receipt JSON" hint="Select the receipt exported by the Migration Publisher Q-App.">
            <input type="file" accept="application/json,.json" onChange={(event) => void readReceiptFile(event)} />
          </Field>
          <Field label="Verification attempts" hint="Bounded polling; pending or unavailable results are never treated as success.">
            <input
              type="number"
              min={1}
              max={60}
              value={attempts}
              onChange={(event) => setAttempts(Number(event.target.value))}
            />
          </Field>
        </div>

        <textarea
          aria-label="Receipt JSON"
          value={receiptText}
          onChange={(event) => setReceiptText(event.target.value)}
          placeholder="Receipt JSON appears here after selecting a file."
          rows={6}
        />

        <div className="row gap wrap">
          <button className="primary" type="button" disabled={!selectedHandoffId || receiptText.trim() === '' || loading} onClick={() => void importReceipt()}>
            Import receipt
          </button>
          <button className="ghost" type="button" disabled={!selectedHandoffId || loading} onClick={() => void verify()}>
            Run independent QDN verification
          </button>
          <button className="ghost" type="button" disabled={!handoff} onClick={() => void openHandoffFolder()}>
            Open selected handoff folder
          </button>
          <button
            className="ghost"
            type="button"
            disabled={!siteResource || siteResource.status !== 'remote_verified'}
            onClick={() => void openPublishedSite()}
          >
            Open published website
          </button>
        </div>

        {handoff && (
          <div className="stack">
            <p className="muted">
              Package {handoff.packageValid ? 'validated' : 'not validated'} · {handoff.resources.length} resources ·
              {' '}{handoff.validation?.filesVerified ?? 0} files hashed · target {handoff.handoff.target.qdnName}
            </p>
            {siteResource && (
              <p className="small warn-text" data-testid="site-deployment">
                Site deployment: {siteResource.service} / {siteResource.name} / <code>{siteResource.identifier}</code>.
                Existing resources with a different service or identifier are not modified.
              </p>
            )}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Kind</th><th>Service</th><th>Identifier</th><th>Status</th><th>Receipt</th><th>Signature</th><th>Bytes</th></tr></thead>
                <tbody>
                  {handoff.resources.map((resource) => (
                    <tr key={resource.id}>
                      <td>{resource.kind}</td>
                      <td>{resource.service}</td>
                      <td><code>{resource.identifier}</code></td>
                      <td><Badge tone={tone(resourceStatus(resource))}>{statusLabel(resourceStatus(resource))}</Badge></td>
                      <td>{resource.publisherReportedStatus ?? '—'}</td>
                      <td>{resource.txSignature ? shortId(resource.txSignature) : '—'}</td>
                      <td>{formatBytes(resource.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {verification && (
          <Alert tone={verification.pendingOrUnverified === 0 ? 'good' : 'warn'} title="Verification result">
            <p>{Object.entries(verification.counts).map(([key, value]) => key + ': ' + value).join(' · ')}</p>
            <p className="small">Evidence: {verification.evidencePath}</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Resource</th><th>State</th><th>Code</th><th>Transport</th></tr></thead>
                <tbody>
                  {verification.results.map((result) => (
                    <tr key={result.resourceId}>
                      <td><code>{shortId(result.resourceId)}</code></td>
                      <td><Badge tone={tone(result.state)}>{statusLabel(result.state)}</Badge></td>
                      <td>{result.code ?? '—'}</td>
                      <td>{result.transport ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Alert>
        )}
      </Card>

      <Card title="Recovery and truthfulness" subtitle="What the statuses mean">
        <ul>
          <li><strong>handoff ready</strong> means bytes are prepared locally and hashed; nothing is published.</li>
          <li><strong>submitted / pending confirmation</strong> are Publisher-reported states and remain unverified.</li>
          <li><strong>remote verified</strong> requires an exact read-back whose SHA-256 and byte length match the handoff.</li>
          <li><strong>ambiguous</strong> means Qortal replied without a definitive per-resource result, or read-back disagreed; reconcile manually and never auto-resubmit.</li>
          <li><strong>failed / declined / blocked</strong> are preserved for an explicit, user-approved retry. This desktop app does not publish or retry in the background.</li>
        </ul>
      </Card>
    </div>
  );
}
