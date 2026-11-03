import { QmsError, ERROR_CODES } from '../errors.js';
import {
  PUBLICATION_RESOURCE_STATES,
  RECEIPT_SCHEMA,
  RECEIPT_VERSION,
  sealDocument,
  verifyDocumentIntegrity,
  publicationStateForReceiptStatus
} from './handoff.js';

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

const HANDOFF_ID = /^hof_[a-z0-9]{8,40}$/;
const BATCH_ID = /^pub_[a-z0-9]{8,40}$/;
const PLAN_ID = /^plan_[a-z0-9]{8,40}$/;
const PROJECT_ID = /^prj_[a-z0-9][a-z0-9-]{3,47}$/;
const SITE_ID = /^site_[a-z0-9]{16,64}$/;
const RESOURCE_ID = /^res_[a-z0-9]{8,40}$/;
const ADDRESS = /^Q[1-9A-HJ-NP-Za-km-z]{20,50}$/;

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(ERROR_CODES.PUBLICATION_RECEIPT_INVALID, label + ' must be an object.');
  }
  return value;
}

function assertString(value, label, { pattern = null, max = 2000, optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    fail(ERROR_CODES.PUBLICATION_RECEIPT_INVALID, label + ' is required.');
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    fail(ERROR_CODES.PUBLICATION_RECEIPT_INVALID, label + ' must be a non-empty string.');
  }
  if (pattern && !pattern.test(value)) {
    fail(ERROR_CODES.PUBLICATION_RECEIPT_INVALID, label + ' has an invalid format.');
  }
  return value;
}

export function createReceipt({
  handoff,
  receiptId,
  publisher,
  results,
  createdAt,
  completedAt = null,
  appVersion = null,
  network = null
}) {
  const counts = {};
  for (const result of results) {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
  }
  return sealDocument({
    schema: RECEIPT_SCHEMA,
    version: RECEIPT_VERSION,
    receiptId,
    handoffId: handoff.handoffId,
    publicationBatchId: handoff.publicationBatchId,
    planId: handoff.planId,
    projectId: handoff.projectId,
    siteId: handoff.siteId,
    target: handoff.target,
    publisher: {
      accountAddress: publisher.accountAddress ?? null,
      name: publisher.name ?? null,
      appVersion: appVersion ?? publisher.appVersion ?? null,
      network: network ?? publisher.network ?? null
    },
    createdAt,
    completedAt,
    results: results.map((result) => ({
      resourceId: result.resourceId,
      service: result.service,
      name: result.name,
      identifier: result.identifier,
      status: publicationStateForReceiptStatus(result.status),
      reason: result.reason ?? null,
      txSignature: result.txSignature ?? null,
      submittedAt: result.submittedAt ?? null,
      confirmedAt: result.confirmedAt ?? null,
      verification: result.verification ?? null
    })),
    counts
  });
}

export function assertReceipt(receipt, { expect = null } = {}) {
  assertObject(receipt, 'receipt');
  if (receipt.schema !== RECEIPT_SCHEMA) {
    fail(ERROR_CODES.PUBLICATION_RECEIPT_INVALID, 'Unsupported receipt schema: ' + String(receipt.schema));
  }
  if (receipt.version !== RECEIPT_VERSION) {
    fail(ERROR_CODES.PUBLICATION_RECEIPT_INVALID, 'Unsupported receipt version: ' + String(receipt.version));
  }
  verifyDocumentIntegrity(receipt, 'receipt');
  assertString(receipt.receiptId, 'receipt.receiptId', { pattern: /^rcp_[a-z0-9]{8,40}$/ });
  assertString(receipt.handoffId, 'receipt.handoffId', { pattern: HANDOFF_ID });
  assertString(receipt.publicationBatchId, 'receipt.publicationBatchId', { pattern: BATCH_ID });
  assertString(receipt.planId, 'receipt.planId', { pattern: PLAN_ID });
  assertString(receipt.projectId, 'receipt.projectId', { pattern: PROJECT_ID });
  assertString(receipt.siteId, 'receipt.siteId', { pattern: SITE_ID });
  const target = assertObject(receipt.target, 'receipt.target');
  assertString(target.qdnName, 'receipt.target.qdnName', { max: 40 });
  const publisher = assertObject(receipt.publisher, 'receipt.publisher');
  assertString(publisher.accountAddress, 'receipt.publisher.accountAddress', { pattern: ADDRESS });
  assertString(publisher.name, 'receipt.publisher.name', { max: 40 });
  assertString(publisher.appVersion, 'receipt.publisher.appVersion', { max: 80, optional: true });
  assertString(publisher.network, 'receipt.publisher.network', { max: 40, optional: true });
  if (!Array.isArray(receipt.results) || receipt.results.length === 0) {
    fail(ERROR_CODES.PUBLICATION_RECEIPT_INVALID, 'receipt.results must be a non-empty array.');
  }
  const seen = new Set();
  for (const [index, result] of receipt.results.entries()) {
    const label = 'receipt.results[' + index + ']';
    assertObject(result, label);
    assertString(result.resourceId, label + '.resourceId', { pattern: RESOURCE_ID });
    if (seen.has(result.resourceId)) {
      fail(ERROR_CODES.PUBLICATION_RECEIPT_INVALID, 'Duplicate receipt resource id: ' + result.resourceId);
    }
    seen.add(result.resourceId);
    assertString(result.service, label + '.service', { max: 20 });
    assertString(result.name, label + '.name', { max: 40 });
    assertString(result.identifier, label + '.identifier', { pattern: /^[a-z0-9][a-z0-9_-]{0,63}$/ });
    if (!PUBLICATION_RESOURCE_STATES.includes(result.status)) {
      fail(ERROR_CODES.PUBLICATION_RECEIPT_INVALID, label + '.status is not a publication state.');
    }
    assertString(result.reason, label + '.reason', { max: 2000, optional: true });
    assertString(result.txSignature, label + '.txSignature', { max: 200, optional: true });
    assertString(result.submittedAt, label + '.submittedAt', { max: 50, optional: true });
    assertString(result.confirmedAt, label + '.confirmedAt', { max: 50, optional: true });
    if (result.verification !== null && result.verification !== undefined) {
      assertObject(result.verification, label + '.verification');
    }
  }
  if (expect) {
    if (receipt.handoffId !== expect.handoffId) {
      fail(ERROR_CODES.PUBLICATION_RECEIPT_MISMATCH, 'Receipt handoff id does not match this publication plan.', {
        expected: expect.handoffId,
        actual: receipt.handoffId
      });
    }
    if (receipt.publicationBatchId !== expect.publicationBatchId) {
      fail(ERROR_CODES.PUBLICATION_RECEIPT_MISMATCH, 'Receipt publication batch id does not match.');
    }
    if (receipt.projectId !== expect.projectId || receipt.siteId !== expect.siteId) {
      fail(ERROR_CODES.PUBLICATION_CROSS_PROJECT, 'Receipt belongs to another project or site identity.', {
        expectedProjectId: expect.projectId,
        actualProjectId: receipt.projectId,
        expectedSiteId: expect.siteId,
        actualSiteId: receipt.siteId
      });
    }
    if (receipt.planId !== expect.planId) {
      fail(ERROR_CODES.PUBLICATION_RECEIPT_MISMATCH, 'Receipt plan id does not match.');
    }
    if (receipt.target?.qdnName !== expect.target?.qdnName) {
      fail(ERROR_CODES.PUBLICATION_RECEIPT_MISMATCH, 'Receipt target name does not match.');
    }
    const resources = new Map(expect.resources.map((resource) => [resource.id, resource]));
    for (const result of receipt.results) {
      const resource = resources.get(result.resourceId);
      if (!resource) {
        fail(ERROR_CODES.PUBLICATION_RECEIPT_MISMATCH, 'Receipt references a resource that is not in the handoff.', {
          resourceId: result.resourceId
        });
      }
      if (
        result.service !== resource.service ||
        result.name !== resource.name ||
        result.identifier !== resource.identifier
      ) {
        fail(ERROR_CODES.PUBLICATION_RECEIPT_MISMATCH, 'Receipt resource identity does not match the handoff.', {
          resourceId: result.resourceId,
          expected: { service: resource.service, name: resource.name, identifier: resource.identifier },
          actual: { service: result.service, name: result.name, identifier: result.identifier }
        });
      }
    }
  }
  return receipt;
}

export function reconcileReceiptResults(receipt, handoffResources) {
  const byId = new Map(receipt.results.map((result) => [result.resourceId, result]));
  return handoffResources.map((resource) => {
    const result = byId.get(resource.id);
    if (!result) {
      return {
        resourceId: resource.id,
        service: resource.service,
        name: resource.name,
        identifier: resource.identifier,
        status: 'ambiguous',
        missing: true,
        reason: 'Receipt did not include this resource; its submission state is unknown.'
      };
    }
    return { ...result };
  });
}
