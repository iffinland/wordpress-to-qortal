import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import type {
  PlanDocument,
  PlanRecord,
  PublicationHandoffDetail,
  PublicationHandoffSummary,
  PublicationPrepareResult,
  PublicationVerifyResult
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

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function Publishing({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [handoffs, setHandoffs] = useState<PublicationHandoffSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [plan, setPlan] = useState<PlanDocument | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectedHandoffId, setSelectedHandoffId] = useState('');
  const [handoff, setHandoff] = useState<PublicationHandoffDetail | null>(null);
  const [prepared, setPrepared] = useState<PublicationPrepareResult | null>(null);
  const [receiptText, setReceiptText] = useState('');
  const [nodeUrl, setNodeUrl] = useState('http://127.0.0.1:12391');
  const [attempts, setAttempts] = useState(6);
  const [verification, setVerification] = useState<PublicationVerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    try {
      const result = await api().publication.prepare(projectId, plan.planId, [...selection], {
        feePerResource: plan.estimates?.feePerResource
      });
      setPrepared(result);
      setMessage('Handoff package created and every payload hash was verified locally.');
      await refresh();
      setSelectedHandoffId(result.handoffId);
    } catch (prepareError) {
      setError(prepareError);
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

        <div className="row gap wrap">
          <button className="primary" type="button" disabled={!plan || selection.size === 0 || loading} onClick={() => void prepareHandoff()}>
            Generate handoff package
          </button>
          <span className="muted">{selection.size} of {actionable.length} resources selected</span>
        </div>

        {prepared && (
          <Alert tone="info" title="Handoff ready">
            <p>{prepared.message}</p>
            <p><code>{prepared.absolutePath}</code></p>
            <p className="small">Open Qortal Hub → Migration Publisher → select this whole folder. The Publisher validates the manifest and every SHA-256 before asking for approval.</p>
            <button type="button" className="ghost" onClick={() => void openHandoffFolder()}>Open handoff folder</button>
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
          <Field label="Qortal node URL (read-only)" hint="Use a node that permits read-only arbitrary reads, or enable QDNAuthBypass.">
            <input value={nodeUrl} onChange={(event) => setNodeUrl(event.target.value)} />
          </Field>
        </div>

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
        </div>

        {handoff && (
          <div className="stack">
            <p className="muted">
              Package {handoff.packageValid ? 'validated' : 'not validated'} · {handoff.resources.length} resources ·
              {' '}{handoff.validation?.filesVerified ?? 0} files hashed · target {handoff.handoff.target.qdnName}
            </p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Kind</th><th>Service</th><th>Identifier</th><th>Status</th><th>Receipt</th><th>Signature</th><th>Bytes</th></tr></thead>
                <tbody>
                  {handoff.resources.map((resource) => (
                    <tr key={resource.id}>
                      <td>{resource.kind}</td>
                      <td>{resource.service}</td>
                      <td><code>{resource.identifier}</code></td>
                      <td><Badge tone={tone(resource.status)}>{statusLabel(resource.status)}</Badge></td>
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
