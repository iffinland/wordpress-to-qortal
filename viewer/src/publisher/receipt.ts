import { RECEIPT_SCHEMA, RECEIPT_VERSION, integrityOf, type HandoffManifest, type PublicationState } from './handoff';
import { requestQortal } from './bridge';

export interface ReceiptResultInput {
  resourceId: string;
  service: string;
  name: string;
  identifier: string;
  status: PublicationState;
  reason?: string | null;
  txSignature?: string | null;
  submittedAt?: string | null;
  confirmedAt?: string | null;
  verification?: Record<string, unknown> | null;
}

export interface ReceiptDocument {
  schema: string;
  version: number;
  receiptId: string;
  handoffId: string;
  publicationBatchId: string;
  planId: string;
  projectId: string;
  siteId: string;
  target: { qdnName: string; resourcePrefix: string };
  publisher: {
    accountAddress: string;
    name: string;
    appVersion: string;
    network: string | null;
  };
  createdAt: string;
  completedAt: string | null;
  results: ReceiptResultInput[];
  counts: Record<string, number>;
  integrity: { algorithm: string; value: string };
}

function randomId(prefix: string): string {
  const random = new Uint8Array(16);
  globalThis.crypto.getRandomValues(random);
  return prefix + [...random].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createReceipt({
  handoff,
  accountAddress,
  accountName,
  appVersion,
  results,
  createdAt,
  network = null
}: {
  handoff: HandoffManifest;
  accountAddress: string;
  accountName: string;
  appVersion: string;
  results: ReceiptResultInput[];
  createdAt: string;
  network?: string | null;
}): Promise<ReceiptDocument> {
  const counts: Record<string, number> = {};
  for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  const body = {
    schema: RECEIPT_SCHEMA,
    version: RECEIPT_VERSION,
    receiptId: randomId('rcp_'),
    handoffId: handoff.handoffId,
    publicationBatchId: handoff.publicationBatchId,
    planId: handoff.planId,
    projectId: handoff.projectId,
    siteId: handoff.siteId,
    target: handoff.target,
    publisher: {
      accountAddress,
      name: accountName,
      appVersion,
      network
    },
    createdAt,
    completedAt: new Date().toISOString(),
    results: results.map((result) => ({
      resourceId: result.resourceId,
      service: result.service,
      name: result.name,
      identifier: result.identifier,
      status: result.status,
      reason: result.reason ?? null,
      txSignature: result.txSignature ?? null,
      submittedAt: result.submittedAt ?? null,
      confirmedAt: result.confirmedAt ?? null,
      verification: result.verification ?? null
    })),
    counts
  };
  const integrity = { algorithm: 'sha256', value: await integrityOf(body) };
  return { ...body, integrity };
}

export async function downloadReceipt(receipt: ReceiptDocument): Promise<'save-file' | 'browser-download'> {
  const text = JSON.stringify(receipt, null, 2);
  const filename = receipt.handoffId + '-receipt.json';
  try {
    await requestQortal({
      action: 'SAVE_FILE',
      blob: new Blob([text], { type: 'application/json' }),
      filename,
      mimeType: 'application/json'
    });
    return 'save-file';
  } catch {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'browser-download';
  }
}

export function receiptFileText(receipt: ReceiptDocument): string {
  return JSON.stringify(receipt, null, 2);
}
